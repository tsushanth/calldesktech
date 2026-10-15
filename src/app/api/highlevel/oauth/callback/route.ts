import { NextRequest, NextResponse } from 'next/server';
import { signLinkToken } from '@/lib/highlevel/crypto';
import { saveInstall } from '@/lib/highlevel/installs';
import { describeTokens, exchangeCode, HighLevelAuthError } from '@/lib/highlevel/oauth';

// HighLevel sends the browser here after an agency or sub-account admin approves the Calldesk app.
// We exchange the code, store the install, and send the browser on to the page where a Calldesk owner links a workspace.
// Nothing about the tokens is ever put in a URL or a log line.

function pageUrl(query: Record<string, string>): string {
  const base = new URL(process.env.HIGHLEVEL_REDIRECT_URI || 'https://calldesk.tech/');
  const u = new URL('/highlevel/link', base.origin);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return u.toString();
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
  const saved = await saveInstall(tokens);
  if (!saved.ok) console.warn('[highlevel] install not stored:', saved.error, JSON.stringify(describeTokens(tokens as never)));
  if (!saved.ok) return NextResponse.redirect(pageUrl({ error: tokens.locationId ? 'install_failed' : 'no_location' }), 303);
  return NextResponse.redirect(pageUrl({ token: signLinkToken(saved.locationId) }), 303);
}
