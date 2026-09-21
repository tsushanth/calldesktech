import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeResource, requireTenantRole } from '@/lib/authz';
import { logAudit } from '@/lib/auditLog';

// GET /api/calls/[id] — see tenants/[id]/route.ts for why this replaces a
// direct (RLS-blocked) client-side Supabase call.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_call_logs', (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_call_logs')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ callLog: data });
}

// DELETE /api/calls/[id] — the endpoint the Privacy page's "customers can
// delete calls from their dashboard" claim was written to describe, before
// it existed. Owner/admin only, same tier as API keys/billing — deleting a
// transcript is data-destructive, not a per-member action.
//
// Removes the row (transcript, extracted data, recording_url/recording_sid
// pointer) from calldesk_call_logs. NOTE — honest scope limit: this does not
// synchronously purge the underlying Twilio-hosted recording audio itself;
// calldesktech holds no Twilio credentials of its own (calls are placed by
// the separate call-loop-poc voice engine). The raw recording is purged by
// that engine's existing retention sweep (enforceRecordingRetention,
// supabase/migrations/022_recording_retention.sql) on its normal schedule —
// clearing recording_sid here just stops that sweep from finding a Sid to
// delete later, since the row is gone. Closing that gap fully needs either
// giving this route Twilio credentials or an immediate-delete signal to
// call-loop-poc; tracked as follow-up, not silently claimed as done here.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const resourceAuth = await authorizeResource(request, 'calldesk_call_logs', id);
  if (!resourceAuth.ok) return resourceAuth.response;
  const tenantId = resourceAuth.tenantId!;

  const roleAuth = await requireTenantRole(request, tenantId, ['owner', 'admin']);
  if (!roleAuth.ok) return roleAuth.response;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('calldesk_call_logs').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    tenantId,
    actorUserId: roleAuth.principal.userId,
    action: 'call.delete',
    resourceType: 'calldesk_call_logs',
    resourceId: id,
  });

  return NextResponse.json({ success: true });
}
