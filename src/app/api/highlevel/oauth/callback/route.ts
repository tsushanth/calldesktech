import { NextRequest, NextResponse } from 'next/server';
import { signLinkToken, signPickToken } from '@/lib/highlevel/crypto';
import { saveInstall } from '@/lib/highlevel/installs';
import { describeTokens, exchangeCode, HighLevelAuthError, listInstalledLocations, locationTokenFor, type HighLevelTokens } from '@/lib/highlevel/oauth';

// HighLevel sends the browser here after an agency or sub-account admin approves the Calldesk app.
// We exchange the code, store the install, and send the browser on to the page where a Calldesk owner links a workspace.
// Nothing about the tokens is ever put in a URL or a log line.

function pageUrl(query: Record<string, string>): string {
  const base = new URL(process.env.HIGHLEVEL_REDIRECT_URI || 'https://calldesk.tech/');
  const u = new URL('/highlevel/link', base.origin);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return u.toString();
}

/**
 * An agency install arrives as one Company token with no sub-account. List the sub-accounts the agency approved and store a token for each,
 * using the agency token (which is not kept). Returns the sub-accounts that were stored.
 */
async function storeAgencyInstall(tokens: HighLevelTokens): Promise<Array<{ id: string; name: string }>> {
  const companyId = tokens.companyId!;
  const locations = await listInstalledLocations(tokens.access_token, companyId);
  const stored: Array<{ id: string; name: string }> = [];
  for (const l of locations) {
    try {
      const saved = await saveInstall(await locationTokenFor(tokens.access_token, companyId, l.id));
      if (saved.ok) stored.push({ id: saved.locationId, name: l.name });
    } catch (e) {
      console.error('[highlevel] agency install: one sub-account failed:', e instanceof HighLevelAuthError ? e.message : 'error');
    }
  }
  return stored;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('error')) return NextResponse.redirect(pageUrl({ error: 'denied' }), 303);
  const code = sp.get('code');
  if (!code) return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 });

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (e) {
    console.error('[highlevel] install failed:', e instanceof HighLevelAuthError ? e.message : 'configuration or network error');
    return NextResponse.redirect(pageUrl({ error: 'install_failed' }), 303);
  }
  if (!tokens.locationId && tokens.companyId) {
    try {
      const stored = await storeAgencyInstall(tokens);
      if (stored.length === 1) return NextResponse.redirect(pageUrl({ token: signLinkToken(stored[0].id) }), 303);
      if (stored.length > 1) return NextResponse.redirect(pageUrl({ pick: signPickToken(stored) }), 303);
    } catch (e) {
      console.error('[highlevel] agency install failed:', e instanceof HighLevelAuthError ? e.message : 'configuration or network error', JSON.stringify(describeTokens(tokens as never)));
      return NextResponse.redirect(pageUrl({ error: 'install_failed' }), 303);
    }
  }
  const saved = await saveInstall(tokens);
  if (!saved.ok) console.warn('[highlevel] install not stored:', saved.error, JSON.stringify(describeTokens(tokens as never)));
  if (!saved.ok) return NextResponse.redirect(pageUrl({ error: tokens.locationId ? 'install_failed' : 'no_location' }), 303);
  return NextResponse.redirect(pageUrl({ token: signLinkToken(saved.locationId) }), 303);
}
