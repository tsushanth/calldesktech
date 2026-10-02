import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyTwilioSignature } from '@/lib/webhookAuth';

// POST /api/twilio/outbound-recording — Twilio calls this when a call's recording is ready. We keep only the
// pointer (recording SID, URL, length) on the call's row; the audio itself stays on Twilio, which keeps it
// until it is deleted, so transcription can run at any later time from the stored SID.
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => { if (typeof v === 'string') params[k] = v; });
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://calldesk.tech').replace(/\/$/, '');
  const verified = verifyTwilioSignature(`${base}/api/twilio/outbound-recording`, params, request.headers.get('x-twilio-signature'), {
    authToken: process.env.TWILIO_OUTBOUND_AUTH_TOKEN,
    failClosed: true,
  });
  if (!verified.ok) {
    console.warn('[outbound-recording] rejected request:', verified.reason);
    return new NextResponse('Forbidden', { status: 401 });
  }
  if (params.RecordingStatus === 'completed' && params.CallSid && params.RecordingSid) {
    const seconds = Number.parseInt(params.RecordingDuration || '', 10);
    const { error } = await getSupabaseAdmin()
      .from('calldesk_outbound_calls')
      .update({
        recording_sid: params.RecordingSid,
        recording_url: params.RecordingUrl || null,
        recording_seconds: Number.isFinite(seconds) ? seconds : null,
      })
      .eq('call_sid', params.CallSid);
    if (error) console.error('[outbound-recording] update failed:', error.message);
  }
  return new NextResponse(null, { status: 204 });
}
