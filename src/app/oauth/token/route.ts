import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase';
import { API_KEY_PREFIX, hashApiKey } from '@/lib/authz';
import { json, pkceMatches, preflight, sha256hex } from '@/lib/oauth';

export const OPTIONS = preflight;

// The access token is a workspace API key (cdk_live_...) minted at exchange
// time, so every /api/v1 authorization rule and the existing revoke UI apply.
export async function POST(req: NextRequest) {
  const ct = req.headers.get('content-type') || '';
  const p: Record<string, string> = ct.includes('json')
    ? await req.json().catch(() => ({}))
    : Object.fromEntries(new URLSearchParams(await req.text()));
  if (p.grant_type !== 'authorization_code') return json({ error: 'unsupported_grant_type' }, 400);
  if (!p.code || !p.code_verifier || !p.client_id || !p.redirect_uri) return json({ error: 'invalid_request' }, 400);

  const db = getSupabaseAdmin();
  const codeHash = sha256hex(p.code);
  const { data: row } = await db.from('calldesk_oauth_codes').select('*').eq('code_hash', codeHash).maybeSingle();
  if (!row || row.used_at || new Date(row.expires_at) < new Date() || row.client_id !== p.client_id || row.redirect_uri !== p.redirect_uri || !pkceMatches(p.code_verifier, row.code_challenge)) {
    return json({ error: 'invalid_grant' }, 400);
  }
  // Single use: only the request that flips used_at gets a token.
  const { data: claimed } = await db.from('calldesk_oauth_codes').update({ used_at: new Date().toISOString() }).eq('code_hash', codeHash).is('used_at', null).select('code_hash');
  if (!claimed?.length) return json({ error: 'invalid_grant' }, 400);

  const { data: client } = await db.from('calldesk_oauth_clients').select('client_name').eq('client_id', row.client_id).maybeSingle();
  const label = `MCP: ${client?.client_name || 'client'}`.slice(0, 100);
  await db.from('calldesk_api_keys').update({ revoked_at: new Date().toISOString() }).eq('tenant_id', row.tenant_id).eq('user_id', row.user_id).eq('name', label).is('revoked_at', null);
  const key = `${API_KEY_PREFIX}${randomBytes(24).toString('hex')}`;
  const { error } = await db.from('calldesk_api_keys').insert({ tenant_id: row.tenant_id, user_id: row.user_id, name: label, key_prefix: key.slice(0, API_KEY_PREFIX.length + 6), key_hash: hashApiKey(key) });
  if (error) return json({ error: 'server_error' }, 500);
  return json({ access_token: key, token_type: 'Bearer', scope: 'mcp' });
}
