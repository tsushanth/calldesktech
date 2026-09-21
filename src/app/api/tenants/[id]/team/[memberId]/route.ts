import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireTenantRole } from '@/lib/authz';
import { logAudit } from '@/lib/auditLog';

// PATCH /api/tenants/[id]/team/[memberId] — change a member's role.
// owner/admin only. The owner row (calldesk_tenants.user_id) has no
// team_members row guaranteed to exist for every legacy tenant, but the
// backfill in migration 038 created one for every real tenant; either way,
// an 'owner'-role row can't be changed here — ownership transfer is out of
// scope (per the RBAC spec) and there must always be exactly one owner.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const { id: tenantId, memberId } = await params;
  const auth = await requireTenantRole(request, tenantId, ['owner', 'admin'], { apiKeysAllowed: false });
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const role = body.role === 'admin' ? 'admin' : body.role === 'member' ? 'member' : null;
  if (!role) {
    return NextResponse.json({ error: "Role must be 'admin' or 'member'" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: target } = await supabase
    .from('calldesk_team_members')
    .select('id, role, tenant_id')
    .eq('id', memberId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (target.role === 'owner') {
    return NextResponse.json({ error: "Can't change the owner's role — transfer ownership instead (not yet supported)" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('calldesk_team_members')
    .update({ role })
    .eq('id', memberId)
    .select('id, user_id, invited_email, role, status, invited_by, created_at, updated_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    tenantId,
    actorUserId: auth.principal.userId,
    action: 'team.role_change',
    resourceType: 'calldesk_team_members',
    resourceId: memberId,
    metadata: { from_role: target.role, to_role: role },
  });

  return NextResponse.json({ member: data });
}

// DELETE /api/tenants/[id]/team/[memberId] — remove a member or cancel a
// pending invite. owner/admin only. The owner can't be removed.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const { id: tenantId, memberId } = await params;
  const auth = await requireTenantRole(request, tenantId, ['owner', 'admin'], { apiKeysAllowed: false });
  if (!auth.ok) return auth.response;

  const supabase = getSupabaseAdmin();
  const { data: target } = await supabase
    .from('calldesk_team_members')
    .select('id, role')
    .eq('id', memberId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (target.role === 'owner') {
    return NextResponse.json({ error: 'The owner cannot be removed' }, { status: 400 });
  }

  const { error } = await supabase.from('calldesk_team_members').delete().eq('id', memberId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    tenantId,
    actorUserId: auth.principal.userId,
    action: 'team.remove',
    resourceType: 'calldesk_team_members',
    resourceId: memberId,
    metadata: { role: target.role },
  });

  return NextResponse.json({ ok: true });
}
