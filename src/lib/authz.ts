import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getMobileUser } from '@/lib/mobile-auth';
import { getSupabaseAdmin } from '@/lib/supabase';

// One place that answers "who is calling, and may they touch this tenant?"
// for every /api route. Before this, only 7 of 70 routes checked anything:
// /api/tenants/<uuid>/calls, /contacts, DELETE /api/agents/<id> and friends
// answered anyone who knew a UUID (UUIDs appear in dashboard URLs, so they
// are identifiers, not secrets).
//
// Three ways in, all resolving to the same Principal:
//   - NextAuth session cookie (the dashboard)
//   - mobile JWT Bearer (the iOS app)
//   - API key Bearer `cdk_live_...` (customers' own servers / the MCP server)
// A session/JWT principal may act on any tenant its user owns; an API key
// is pinned to exactly one tenant.

export interface Principal {
  via: 'session' | 'mobile' | 'apikey';
  userId: string | null;
  /** Set for API keys: the only tenant this key may touch. */
  tenantId: string | null;
  apiKeyId?: string;
}

export const API_KEY_PREFIX = 'cdk_live_';

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function getPrincipal(request: NextRequest): Promise<Principal | null> {
  const header = request.headers.get('authorization') || '';
  if (header.startsWith(`Bearer ${API_KEY_PREFIX}`)) {
    const key = header.slice('Bearer '.length).trim();
    const { data } = await getSupabaseAdmin()
      .from('calldesk_api_keys')
      .select('id, tenant_id, user_id, revoked_at')
      .eq('key_hash', hashApiKey(key))
      .maybeSingle();
    if (!data || data.revoked_at) return null;
    // Best-effort usage stamp — never blocks or fails the request.
    getSupabaseAdmin().from('calldesk_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => {}, () => {});
    return { via: 'apikey', userId: data.user_id ?? null, tenantId: data.tenant_id, apiKeyId: data.id };
  }

  const session = await getServerSession(authOptions);
  if (session?.user?.id) return { via: 'session', userId: session.user.id, tenantId: null };

  const mobile = await getMobileUser(request);
  if (mobile) return { via: 'mobile', userId: mobile.id, tenantId: null };
  return null;
}

export type AuthResult =
  | { ok: true; principal: Principal; tenantId?: string }
  | { ok: false; response: NextResponse };

const deny = (status: 401 | 403 | 404, error: string): AuthResult => ({
  ok: false,
  response: NextResponse.json({ error }, { status }),
});

/** Any authenticated caller — for routes with no tenant (e.g. LLM flow generation). */
export async function requireAuth(request: NextRequest): Promise<AuthResult> {
  const principal = await getPrincipal(request);
  if (!principal) return deny(401, 'Unauthorized');
  return { ok: true, principal };
}

/** May this caller act on this tenant? 404 (not 403) for a tenant you don't own, so ids can't be probed. */
export async function authorizeTenant(request: NextRequest, tenantId: string): Promise<AuthResult> {
  const principal = await getPrincipal(request);
  if (!principal) return deny(401, 'Unauthorized');
  if (principal.via === 'apikey') {
    if (principal.tenantId !== tenantId) return deny(404, 'Not found');
    return { ok: true, principal, tenantId };
  }
  const { data } = await getSupabaseAdmin()
    .from('calldesk_tenants')
    .select('id')
    .eq('id', tenantId)
    .eq('user_id', principal.userId!)
    .maybeSingle();
  if (!data) return deny(404, 'Not found');
  return { ok: true, principal, tenantId };
}

/** Resolve a row's tenant (directly, or through its agent) and authorize against it. */
export async function authorizeResource(
  request: NextRequest,
  table:
    | 'calldesk_agents'
    | 'calldesk_conversation_flows'
    | 'calldesk_subflows'
    | 'calldesk_knowledge_bases'
    | 'calldesk_call_logs'
    | 'calldesk_phone_numbers'
    | 'calldesk_batch_calls'
    | 'calldesk_chat_sessions'
    | 'calldesk_agent_versions',
  id: string
): Promise<AuthResult> {
  // Authenticate first so an unauthenticated caller can't probe which ids exist.
  const principal = await getPrincipal(request);
  if (!principal) return deny(401, 'Unauthorized');

  const supabase = getSupabaseAdmin();
  let tenantId: string | null = null;
  if (table === 'calldesk_agent_versions') {
    const { data: version } = await supabase.from('calldesk_agent_versions').select('agent_id').eq('id', id).maybeSingle();
    if (version?.agent_id) {
      const { data: agent } = await supabase.from('calldesk_agents').select('tenant_id').eq('id', version.agent_id).maybeSingle();
      tenantId = agent?.tenant_id ?? null;
    }
  } else {
    const { data } = await supabase.from(table).select('tenant_id').eq('id', id).maybeSingle();
    tenantId = data?.tenant_id ?? null;
  }
  if (!tenantId) return deny(404, 'Not found');
  return authorizeTenant(request, tenantId);
}

/**
 * A client-supplied id (in a body or query) must belong to the tenant the
 * caller was authorized for — otherwise tenant A could point its number at,
 * or run batches with, tenant B's agent version just by knowing its id.
 */
export async function belongsToTenant(
  table: 'calldesk_agents' | 'calldesk_agent_versions' | 'calldesk_phone_numbers',
  id: string,
  tenantId: string
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  if (table === 'calldesk_agent_versions') {
    const { data: v } = await supabase.from('calldesk_agent_versions').select('agent_id').eq('id', id).maybeSingle();
    if (!v?.agent_id) return false;
    const { data: a } = await supabase.from('calldesk_agents').select('tenant_id').eq('id', v.agent_id).maybeSingle();
    return a?.tenant_id === tenantId;
  }
  const { data } = await supabase.from(table).select('tenant_id').eq('id', id).maybeSingle();
  return data?.tenant_id === tenantId;
}
