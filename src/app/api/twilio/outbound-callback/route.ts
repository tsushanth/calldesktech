import { NextRequest, NextResponse } from 'next/server';
import { verifyTwilioSignature } from '@/lib/webhookAuth';
import { xmlEscape } from '@/lib/outboundCalling';

// POST /api/twilio/outbound-callback — the Voice URL of the numbers the callers dial OUT from. Prospects
// call these back, and a number that rings out or goes dead gets flagged, so answer with a short, honest
// message. (A fuller version, an agent that takes the caller's details, comes later.)
const MESSAGE =
  'Thanks for calling CallDesk. We build A I phone agents that answer every call for small businesses. ' +
  'To learn more, visit calldesk dot tech. Goodbye.';

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => { if (typeof v === 'string') params[k] = v; });
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://calldesk.tech').replace(/\/$/, '');
  const verified = verifyTwilioSignature(`${base}/api/twilio/outbound-callback`, params, request.headers.get('x-twilio-signature'), {
    authToken: process.env.TWILIO_OUTBOUND_AUTH_TOKEN,
    failClosed: true,
  });
  if (!verified.ok) return new NextResponse('Forbidden', { status: 401 });
  // A prospect calling back is a warm signal worth noticing; Twilio's call log has the caller's number.
  console.log(`[outbound-callback] inbound call to ${params.To || '?'} from ${params.From || '?'}`);
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${xmlEscape(MESSAGE)}</Say><Hangup/></Response>`,
    { status: 200, headers: { 'Content-Type': 'text/xml' } },
  );
}
