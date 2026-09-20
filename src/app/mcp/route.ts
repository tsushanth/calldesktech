import { NextRequest } from 'next/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { API_KEY_PREFIX, hashApiKey } from '@/lib/authz';
import { getSupabaseAdmin } from '@/lib/supabase';
import { CORS, originOf, preflight } from '@/lib/oauth';
import { registerTools } from '@/lib/mcp/tools';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

const unauthorized = (req: NextRequest) =>
  new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { ...CORS, 'Content-Type': 'application/json', 'WWW-Authenticate': `Bearer resource_metadata="${originOf(req)}/.well-known/oauth-protected-resource/mcp"` },
  });

// Stateless Streamable HTTP MCP endpoint. The bearer is a workspace API key
// (issued via OAuth at /oauth/token, or pasted by hand); tools call /api/v1 with it.
export async function POST(req: NextRequest) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token.startsWith(API_KEY_PREFIX)) return unauthorized(req);
  const { data: key } = await getSupabaseAdmin().from('calldesk_api_keys').select('id, revoked_at').eq('key_hash', hashApiKey(token)).maybeSingle();
  if (!key || key.revoked_at) return unauthorized(req);

  const base = process.env.INTERNAL_API_BASE || `http://127.0.0.1:${process.env.PORT || 3000}/api/v1`;
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 500) }; }
    if (!res.ok) throw new Error(`${method} ${path} failed (${res.status}): ${data?.error || `HTTP ${res.status}`}`);
    return data;
  };
  let tenantId: Promise<string> | undefined;
  const tenant = () => (tenantId ??= api('GET', '/me').then((m) => {
    if (!m.tenantId) throw new Error('This key is not pinned to a workspace.');
    return m.tenantId as string;
  }));

  const server = new McpServer({ name: 'calldesktech', version: '1.1.0' });
  registerTools(server, api, tenant);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(req);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

export const GET = (req: NextRequest) => {
  const header = req.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? new Response('Method not allowed', { status: 405, headers: CORS }) : unauthorized(req);
};
export const DELETE = () => new Response(null, { status: 405, headers: CORS });
