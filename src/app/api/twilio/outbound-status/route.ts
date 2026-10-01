import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyTwilioSignature } from '@/lib/webhookAuth';
import { EMPTY_TWIML, mapDialStatus } from '@/lib/outboundCalling';

// POST /api/twilio/outbound-status — the <Dial action> for /api/twilio/outbound-voice. Twilio calls it when
// the far-end leg finishes with DialCallStatus (completed / no-answer / busy / failed / canceled) and
// DialCallDuration, which is how an unanswered dial still ends up in the log.
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => { if (typeof v === 'string') params[k] = v; });

  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://calldesk.tech').replace(/\/$/, '');
  const verified = verifyTwilioSignature(`${base}/api/twilio/outbound-status`, params, request.headers.get('x-twilio-signature'), {
    authToken: process.env.TWILIO_OUTBOUND_AUTH_TOKEN,
    failClosed: true,
  });
  if (!verified.ok) {
    console.warn('[outbound-status] rejected request:', verified.reason);
    return new NextResponse('Forbidden', { status: 401 });
  }

  // Two callers reach this route: <Dial action> (parent CallSid + DialCallStatus/DialCallDuration) and the
  // <Number> status callbacks (child CallSid + ParentCallSid + CallStatus/CallDuration). Both resolve to
  // the parent call's row.
  const parentSid = params.ParentCallSid || params.CallSid;
  const mapped = mapDialStatus(params.DialCallStatus ?? params.CallStatus);
  const durationRaw = Number.parseInt(params.DialCallDuration ?? params.CallDuration ?? '', 10);
  if (parentSid && mapped) {
    const update: Record<string, unknown> = { status: mapped.status, answered: mapped.answered };
    if (Number.isFinite(durationRaw)) update.duration_seconds = durationRaw;
    if (mapped.final) update.ended_at = new Date().toISOString();
    let q = getSupabaseAdmin().from('calldesk_outbound_calls').update(update).eq('call_sid', parentSid);
    // An "answered" event arriving late must not undo a recorded outcome.
    if (!mapped.final) q = q.eq('status', 'initiated');
    const { error } = await q;
    if (error) console.error('[outbound-status] update failed:', error.message);
  }
  return new NextResponse(EMPTY_TWIML, { status: 200, headers: { 'Content-Type': 'text/xml' } });
}
