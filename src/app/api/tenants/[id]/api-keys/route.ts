import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireTenantRole, hashApiKey, API_KEY_PREFIX } from '@/lib/authz';

// Key management is session/mobile, owner/admin only — an API key can never
// list, mint, or revoke keys (so a leaked key can't create a durable
// backdoor), and a plain 'member' can't mint credentials for the tenant
// either (RBAC: API keys are an admin-and-up capability).
async function ownerOnly(request: NextRequest, tenantId: string) {
  return requireTenantRole(request, tenantId, ['owner', 'admin'], { apiKeysAllowed: false });
}

// GET /api/tenants/[id]/api-keys — list keys (prefix only, never the secret)
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  const auth = await ownerOnly(request, tenantId);
  if (!auth.ok) return auth.response;
  const { data, error } = await getSupabaseAdmin()
    .from('calldesk_api_keys')
    .select('id, name, key_prefix, last_used_at, revoked_at, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ keys: data });
}

// POST /api/tenants/[id]/api-keys — create a key. The plaintext is returned
// exactly once, here; only its SHA-256 is stored.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  const auth = await ownerOnly(request, tenantId);
  if (!auth.ok) return auth.response;
  const { name } = await request.json().catch(() => ({}));
  const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : 'API key';

  const { count } = await getSupabaseAdmin()
    .from('calldesk_api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .is('revoked_at', null);
  if ((count ?? 0) >= 20) {
    return NextResponse.json({ error: 'Limit of 20 active API keys reached — revoke one first' }, { status: 400 });
  }

  const key = `${API_KEY_PREFIX}${randomBytes(24).toString('hex')}`;
  const { data, error } = await getSupabaseAdmin()
    .from('calldesk_api_keys')
    .insert({
      tenant_id: tenantId,
      user_id: auth.principal.userId,
      name: label,
      key_prefix: key.slice(0, API_KEY_PREFIX.length + 6),
      key_hash: hashApiKey(key),
    })
    .select('id, name, key_prefix, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ key: { ...data, secret: key } }, { status: 201 });
}
