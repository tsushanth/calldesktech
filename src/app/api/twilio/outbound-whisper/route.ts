import { NextRequest, NextResponse } from 'next/server';
import { verifyTwilioSignature } from '@/lib/webhookAuth';
import { RECORDING_NOTICE_TWIML } from '@/lib/outboundCalling';

// POST /api/twilio/outbound-whisper — TwiML Twilio runs on the CALLED party's leg right after they answer and
// before they are connected to the caller: a short recording notice. Only used when OUTBOUND_RECORDING=1.
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => { if (typeof v === 'string') params[k] = v; });
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://calldesk.tech').replace(/\/$/, '');
  const verified = verifyTwilioSignature(`${base}/api/twilio/outbound-whisper`, params, request.headers.get('x-twilio-signature'), {
    authToken: process.env.TWILIO_OUTBOUND_AUTH_TOKEN,
    failClosed: true,
  });
  if (!verified.ok) return new NextResponse('Forbidden', { status: 401 });
  return new NextResponse(RECORDING_NOTICE_TWIML, { status: 200, headers: { 'Content-Type': 'text/xml' } });
}
