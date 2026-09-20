import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { json, preflight, randomToken, validRedirectUri } from '@/lib/oauth';

export const OPTIONS = preflight;

// RFC 7591 dynamic client registration. Public clients only (PKCE, no secret).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const uris: unknown = body?.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every((u) => typeof u === 'string' && validRedirectUri(u))) {
    return json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must be 1-10 https, localhost or app-scheme URIs' }, 400);
  }
  const name = typeof body?.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : 'MCP client';
  const clientId = `mcp_${randomToken(18)}`;
  const { error } = await getSupabaseAdmin().from('calldesk_oauth_clients').insert({ client_id: clientId, client_name: name, redirect_uris: uris });
  if (error) return json({ error: 'server_error' }, 500);
  return json({ client_id: clientId, client_name: name, redirect_uris: uris, grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none' }, 201);
}
