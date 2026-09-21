import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant, requireTenantRole } from '@/lib/authz';

// GET /api/tenants/[id]/team — list members (active + pending invites).
// Any active team member (or the owner, or a tenant-scoped API key) can
// view the roster; only owner/admin can invite/remove/change roles (see
// POST below and [memberId]/route.ts).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  const auth = await authorizeTenant(request, tenantId);
  if (!auth.ok) return auth.response;

  const { data, error } = await getSupabaseAdmin()
    .from('calldesk_team_members')
    .select('id, user_id, invited_email, role, status, invited_by, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach display info (email/name) for active members with a user_id.
  const userIds = (data ?? []).map((m) => m.user_id).filter((v): v is string => !!v);
  let usersById: Record<string, { email: string | null; name: string | null }> = {};
  if (userIds.length > 0) {
    const { data: users } = await getSupabaseAdmin()
      .from('calldesk_users')
      .select('id, email, name')
      .in('id', userIds);
    usersById = Object.fromEntries((users ?? []).map((u) => [u.id, { email: u.email, name: u.name }]));
  }

  const members = (data ?? []).map((m) => ({
    ...m,
    email: m.user_id ? usersById[m.user_id]?.email ?? null : m.invited_email,
    name: m.user_id ? usersById[m.user_id]?.name ?? null : null,
  }));

  return NextResponse.json({ members });
}

// POST /api/tenants/[id]/team — invite a member: { email, role }. Creates a
// status:'invited' row. NOTE: this does not send an actual email — that's a
// real gap, not faked here. The invite is accepted the next time someone
// signs in with a matching email (see src/lib/auth.ts's signIn callback),
// which flips the row to status:'active'.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  const auth = await requireTenantRole(request, tenantId, ['owner', 'admin'], { apiKeysAllowed: false });
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = body.role === 'admin' ? 'admin' : body.role === 'member' ? 'member' : null;
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }
  if (!role) {
    return NextResponse.json({ error: "Role must be 'admin' or 'member'" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // If the email already belongs to a calldesk_users row, invite them
  // directly as active rather than leaving a dangling pending invite that
  // would never get picked up (the signIn callback only flips invites for
  // *future* sign-ins, not people already signed in under this email).
  const { data: existingUser } = await supabase
    .from('calldesk_users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  const { data: existingMember } = await supabase
    .from('calldesk_team_members')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .or(existingUser ? `user_id.eq.${existingUser.id},invited_email.eq.${email}` : `invited_email.eq.${email}`)
    .maybeSingle();
  if (existingMember) {
    return NextResponse.json({ error: 'This person is already a member or has a pending invite' }, { status: 409 });
  }

  const { data, error } = await supabase
    .from('calldesk_team_members')
    .insert({
      tenant_id: tenantId,
      user_id: existingUser?.id ?? null,
      invited_email: existingUser ? null : email,
      role,
      status: existingUser ? 'active' : 'invited',
      invited_by: auth.principal.userId,
    })
    .select('id, user_id, invited_email, role, status, invited_by, created_at, updated_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ member: data }, { status: 201 });
}
