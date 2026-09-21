import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireTenantRole } from '@/lib/authz';
import { exchangeHubSpotCode } from '@/lib/hubspot';

// GET /api/integrations/hubspot/callback — HubSpot redirects here after the
// user approves (or denies) the connection. Lives outside src/app/oauth
// (that tree is this app's own NextAuth OAuth *provider* config, owned by
// another agent today) and outside src/app/api/tenants/[id] (state, not a
// path param, is what tells us which tenant this belongs to).
export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  const integrationsUrl = `${appUrl}/dashboard/integrations`;

  const error = request.nextUrl.searchParams.get('error');
  if (error) {
    return NextResponse.redirect(`${integrationsUrl}?hubspot=denied`);
  }

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state') || '';
  if (!code || !state) {
    return NextResponse.redirect(`${integrationsUrl}?hubspot=error`);
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.redirect(`${integrationsUrl}?hubspot=error`);
  }

  // Verify the state HMAC (src/app/api/tenants/[id]/crm/hubspot/connect
  // signed it) before trusting the embedded tenant id.
  const parts = state.split('.');
  if (parts.length !== 3) {
    return NextResponse.redirect(`${integrationsUrl}?hubspot=error`);
  }
  const [tenantId, nonce, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(`${tenantId}.${nonce}`).digest('hex');
  const sigOk =
    sig.length === expectedSig.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
  if (!sigOk) {
    return NextResponse.redirect(`${integrationsUrl}?hubspot=error`);
  }
  // Nonce is a base36 timestamp; reject anything older than 10 minutes so a
  // leaked/replayed state link can't be used indefinitely.
  const issuedAt = parseInt(nonce, 36);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > 10 * 60 * 1000) {
    return NextResponse.redirect(`${integrationsUrl}?hubspot=expired`);
  }

  // Re-authorize independently of the signed state: the state only proves
  // *someone* with owner/admin on this tenant started the flow, not that the
  // browser completing it now is still that person/session. Requiring
  // owner/admin again here closes the gap where a stolen state link could
  // attach an attacker's HubSpot account to someone else's tenant.
  const auth = await requireTenantRole(request, tenantId, ['owner', 'admin'], { apiKeysAllowed: false });
  if (!auth.ok) {
    return NextResponse.redirect(`${integrationsUrl}?hubspot=unauthorized`);
  }

  try {
    const redirectUri = `${appUrl}/api/integrations/hubspot/callback`;
    const tokens = await exchangeHubSpotCode(code, redirectUri);

    // Best-effort hub id for display (`provider_account_id`); never blocks
    // the connection on this succeeding.
    let hubId: string | null = null;
    try {
      const infoRes = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${tokens.access_token}`);
      if (infoRes.ok) {
        const info = await infoRes.json();
        hubId = info?.hub_id ? String(info.hub_id) : null;
      }
    } catch {
      // ignore — cosmetic only
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const { error: dbError } = await getSupabaseAdmin()
      .from('calldesk_crm_connections')
      .upsert(
        {
          tenant_id: tenantId,
          provider: 'hubspot',
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: expiresAt,
          provider_account_id: hubId,
          connected_by: auth.principal.userId,
        },
        { onConflict: 'tenant_id,provider' }
      );
    if (dbError) {
      console.error('Failed to store HubSpot connection:', dbError.message);
      return NextResponse.redirect(`${integrationsUrl}?hubspot=error`);
    }
  } catch (err) {
    // Deliberately never logs `code` or token bytes — HubSpotApiError bodies
    // for the token endpoint are redacted in src/lib/hubspot.ts.
    console.error('HubSpot OAuth exchange failed:', err instanceof Error ? err.message : err);
    return NextResponse.redirect(`${integrationsUrl}?hubspot=error`);
  }

  return NextResponse.redirect(`${integrationsUrl}?hubspot=connected`);
}
