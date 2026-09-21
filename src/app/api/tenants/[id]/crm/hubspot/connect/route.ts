import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireTenantRole } from '@/lib/authz';
import { buildHubSpotAuthorizeUrl } from '@/lib/hubspot';

// GET /api/tenants/[id]/crm/hubspot/connect — start the OAuth dance. This is
// a browser navigation (the "Connect HubSpot" button), not a JSON API call:
// it 302s straight to HubSpot's authorize screen.
//
// `state` carries the tenant id plus an HMAC over it (same construction as
// webhook signing in src/lib/webhooks.ts) so the callback can trust which
// tenant to attach the connection to without a server-side session store —
// HubSpot echoes `state` back verbatim, and we just re-verify the HMAC.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  const auth = await requireTenantRole(request, tenantId, ['owner', 'admin'], { apiKeysAllowed: false });
  if (!auth.ok) return auth.response;

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'NEXTAUTH_SECRET is not configured' }, { status: 500 });
  }
  if (!process.env.HUBSPOT_CLIENT_ID) {
    return NextResponse.json({ error: 'HUBSPOT_CLIENT_ID is not configured' }, { status: 500 });
  }

  const nonce = Date.now().toString(36);
  const payload = `${tenantId}.${nonce}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const state = `${payload}.${sig}`;

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/hubspot/callback`;
  const authorizeUrl = buildHubSpotAuthorizeUrl(redirectUri, state);
  return NextResponse.redirect(authorizeUrl);
}
