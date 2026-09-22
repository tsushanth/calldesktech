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

// Deletes the underlying Twilio-hosted recording for a call, if any.
// Mirrors the exact pattern already proven in call-loop-poc's
// enforceRecordingRetention (realtime-tts/call-loop-poc/server.js): a plain
// DELETE to the Recordings resource with HTTP Basic auth, using the same
// Twilio account that placed the call.
//
// Return shape: 'purged' (Twilio confirmed deletion, incl. treating a 404 as
// already-gone — the retention sweep or a prior delete may have beaten us to
// it), or 'failed' (a genuine Twilio error — 401/500/network) so the caller
// can record that in the audit trail rather than silently pretending it
// worked.
async function deleteTwilioRecording(recordingSid: string): Promise<'purged' | 'failed'> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    console.error('[calls.delete] TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not configured; cannot purge recording', recordingSid);
    return 'failed';
  }
  const auth64 = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.json`,
      { method: 'DELETE', headers: { Authorization: `Basic ${auth64}` } }
    );
    // 404 means it's already gone (e.g. call-loop-poc's own retention sweep
    // got there first) — that's success from our perspective, not a failure.
    if (res.ok || res.status === 404) return 'purged';
    console.error(`[calls.delete] failed to delete Twilio recording ${recordingSid}: HTTP ${res.status}`);
    return 'failed';
  } catch (err) {
    console.error(`[calls.delete] failed to delete Twilio recording ${recordingSid}`, err);
    return 'failed';
  }
}

// DELETE /api/calls/[id] — the endpoint the Privacy page's "customers can
// delete calls from their dashboard" claim was written to describe, before
// it existed. Owner/admin only, same tier as API keys/billing — deleting a
// transcript is data-destructive, not a per-member action.
//
// Removes the row (transcript, extracted data, recording_url/recording_sid
// pointer) from calldesk_call_logs, and — as of the addition of
// TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN as Fly secrets on this app — also
// synchronously purges the underlying Twilio-hosted recording audio itself,
// using the same Twilio account call-loop-poc places calls with. This
// closes the gap that used to be documented here: calldesktech previously
// held no Twilio credentials of its own, so the recording could only be
// cleaned up later by call-loop-poc's own retention sweep
// (enforceRecordingRetention, supabase/migrations/022_recording_retention.sql).
//
// Twilio-call failure handling: a 404 (recording already deleted, e.g. by
// that retention sweep, or by a prior call to this same endpoint) is treated
// as success — nothing left to purge. A genuine Twilio failure (401, 500,
// network error) does NOT block deletion of the DB row: the transcript/PII
// removal is the more time-sensitive compliance concern, and refusing to
// delete the row would leave the PII sitting there while ALSO not fixing
// the recording. Instead the Twilio failure is logged loudly (console.error
// above, plus recorded in the audit metadata below) so it surfaces as a
// followup rather than being silently swallowed.
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

  const { data: callLog } = await supabase
    .from('calldesk_call_logs')
    .select('recording_sid')
    .eq('id', id)
    .maybeSingle();
  const recordingSid: string | null = callLog?.recording_sid ?? null;

  let recordingPurgeResult: 'purged' | 'failed' | 'not_applicable' = 'not_applicable';
  if (recordingSid) {
    recordingPurgeResult = await deleteTwilioRecording(recordingSid);
  }

  const { error } = await supabase.from('calldesk_call_logs').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    tenantId,
    actorUserId: roleAuth.principal.userId,
    action: 'call.delete',
    resourceType: 'calldesk_call_logs',
    resourceId: id,
    metadata: {
      recording_sid: recordingSid,
      recording_purge_result: recordingPurgeResult,
    },
  });

  return NextResponse.json({ success: true });
}
