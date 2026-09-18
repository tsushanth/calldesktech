import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

// DELETE /api/tenants/[id]/api-keys/[keyId] — revoke (keeps the row so
// "last used" history survives; the hash stops authenticating immediately).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; keyId: string }> }
) {
  const { id: tenantId, keyId } = await params;
  const auth = await authorizeTenant(request, tenantId);
  if (!auth.ok) return auth.response;
  if (auth.principal.via === 'apikey') {
    return NextResponse.json({ error: 'API keys cannot manage API keys' }, { status: 403 });
  }
  const { error } = await getSupabaseAdmin()
    .from('calldesk_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('tenant_id', tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
