import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireTenantRole } from '@/lib/authz';
import { logAudit } from '@/lib/auditLog';

// DELETE /api/tenants/[id]/api-keys/[keyId] — revoke (keeps the row so
// "last used" history survives; the hash stops authenticating immediately).
// owner/admin only — matches GET/POST in the sibling route (api-keys are an
// admin-and-up capability; a plain 'member' should not be able to revoke a
// key another admin depends on, any more than they can mint one).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; keyId: string }> }
) {
  const { id: tenantId, keyId } = await params;
  const auth = await requireTenantRole(request, tenantId, ['owner', 'admin'], { apiKeysAllowed: false });
  if (!auth.ok) return auth.response;
  const { error } = await getSupabaseAdmin()
    .from('calldesk_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('tenant_id', tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    tenantId,
    actorUserId: auth.principal.userId,
    action: 'apikey.revoke',
    resourceType: 'calldesk_api_keys',
    resourceId: keyId,
  });

  return NextResponse.json({ success: true });
}
