import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireTenantRole } from '@/lib/authz';

// GET /api/tenants/[id]/crm — connection status for every provider.
// Tokens are never selected here (write-only exposure, same principle as
// calldesk_api_keys.key_hash never coming back from GET /api-keys).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  const auth = await requireTenantRole(request, tenantId, ['owner', 'admin', 'member'], { apiKeysAllowed: true });
  if (!auth.ok) return auth.response;

  const { data, error } = await getSupabaseAdmin()
    .from('calldesk_crm_connections')
    .select('id, provider, provider_account_id, connected_by, expires_at, created_at')
    .eq('tenant_id', tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connections: data });
}

// DELETE /api/tenants/[id]/crm?provider=hubspot — disconnect.
// Owner/admin only, matching the API-key revoke bar (a connected CRM is a
// standing credential like an API key, not a per-member setting).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  const auth = await requireTenantRole(request, tenantId, ['owner', 'admin'], { apiKeysAllowed: false });
  if (!auth.ok) return auth.response;

  const provider = request.nextUrl.searchParams.get('provider');
  if (provider !== 'hubspot' && provider !== 'salesforce') {
    return NextResponse.json({ error: 'provider must be hubspot or salesforce' }, { status: 400 });
  }

  const { error } = await getSupabaseAdmin()
    .from('calldesk_crm_connections')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('provider', provider);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
