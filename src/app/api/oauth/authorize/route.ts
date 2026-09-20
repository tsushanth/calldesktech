import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { randomToken, sha256hex } from '@/lib/oauth';

// Consent form target. Session-only: the user approving must be signed in and must own the workspace.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const form = await req.formData();
  const g = (k: string) => String(form.get(k) || '');
  const back = (redirectUri: string, params: Record<string, string>) => {
    const u = new URL(redirectUri);
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
    return NextResponse.redirect(u.toString(), 303);
  };
  if (!session?.user?.id) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const db = getSupabaseAdmin();
  const { data: client } = await db.from('calldesk_oauth_clients').select('redirect_uris').eq('client_id', g('client_id')).maybeSingle();
  const redirectUri = g('redirect_uri');
  if (!client || !client.redirect_uris.includes(redirectUri)) return NextResponse.json({ error: 'Unknown client or redirect URI' }, { status: 400 });
  const state = g('state');
  if (g('decision') !== 'approve') return back(redirectUri, { error: 'access_denied', state });
  if (g('code_challenge_method') !== 'S256' || !g('code_challenge')) return back(redirectUri, { error: 'invalid_request', state });

  const { data: tenant } = await db.from('calldesk_tenants').select('id').eq('id', g('tenant_id')).eq('user_id', session.user.id).maybeSingle();
  if (!tenant) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

  const code = randomToken(32);
  const { error } = await db.from('calldesk_oauth_codes').insert({
    code_hash: sha256hex(code), client_id: g('client_id'), user_id: session.user.id, tenant_id: tenant.id,
    redirect_uri: redirectUri, code_challenge: g('code_challenge'), expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
  if (error) return back(redirectUri, { error: 'server_error', state });
  return back(redirectUri, { code, state });
}
