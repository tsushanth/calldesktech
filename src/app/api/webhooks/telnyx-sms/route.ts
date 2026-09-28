import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { dispatchWebhookEvent } from '@/lib/webhooks';
import { verifyTelnyxSignature, verifyTwilioSignature, internalForwardHeaders } from '@/lib/webhookAuth';
import { isStopKeyword, isHelpKeyword, recordOptOut, HELP_TEXT, STOP_CONFIRMATION_TEXT } from '@/lib/smsOptOut';
import { getSmsProvider } from '@/lib/smsProvider';

// POST /api/webhooks/telnyx-sms — receives inbound SMS from Telnyx (or,
// as a fallback, Twilio-format form-encoded POSTs).
//
// Signature verification: Telnyx requests are verified via Ed25519
// (telnyx-signature-ed25519 / telnyx-timestamp headers against
// TELNYX_PUBLIC_KEY); Twilio-format requests via X-Twilio-Signature
// (against TWILIO_AUTH_TOKEN). Both checks fail-open (allow + warn) when
// their secret isn't configured, and fail-closed (401) once it is — see
// src/lib/webhookAuth.ts.
export async function POST(request: NextRequest) {
  let raw: any = {};
  let rawText = '';
  let formParams: Record<string, string> | null = null;

  rawText = await request.text();

  // Try JSON first (Telnyx)
  try {
    raw = JSON.parse(rawText);
  } catch {
    try {
      // Fall back to form-encoded (Twilio)
      const params = new URLSearchParams(rawText);
      const obj: Record<string, string> = {};
      params.forEach((v, k) => { obj[k] = v; });
      raw = obj;
      formParams = obj;
    } catch (e) {
      console.error('[telnyx-sms] Cannot parse body:', e);
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }
  }

  if (formParams) {
    // Twilio-format request — verify X-Twilio-Signature
    const twilioResult = verifyTwilioSignature(
      request.url,
      formParams,
      request.headers.get('x-twilio-signature'),
    );
    if (!twilioResult.ok) {
      console.warn('[telnyx-sms] Twilio signature verification failed:', twilioResult.reason);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } else {
    // Telnyx JSON request — verify telnyx-signature-ed25519
    const telnyxResult = verifyTelnyxSignature(
      rawText,
      request.headers.get('telnyx-signature-ed25519'),
      request.headers.get('telnyx-timestamp'),
    );
    if (!telnyxResult.ok) {
      console.warn('[telnyx-sms] Telnyx signature verification failed:', telnyxResult.reason);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  // --- Try Telnyx format first ---
  const eventType = raw?.data?.event_type;
  const payload = raw?.data?.payload;

  let toNumber: string | null = null;
  let fromNumber: string | null = null;
  let text = '';
  let providerMessageId: string | null = null;
  let providerName = 'unknown';

  if (eventType === 'message.received' && payload) {
    // Telnyx v2 format: to is array, from is object
    const toEntry = Array.isArray(payload.to) ? payload.to[0] : payload.to;
    toNumber = normalizeE164(
      typeof toEntry === 'string' ? toEntry : toEntry?.phone_number
    );
    fromNumber = normalizeE164(
      typeof payload.from === 'string' ? payload.from : payload.from?.phone_number
    );
    text = payload.text || '';
    providerMessageId = payload.id || raw?.data?.id;
    providerName = 'telnyx';
  } else if (raw.From && raw.To && raw.Body) {
    // Twilio flat format
    toNumber = normalizeE164(raw.To);
    fromNumber = normalizeE164(raw.From);
    text = raw.Body || '';
    providerMessageId = raw.MessageSid || raw.SmsSid || null;
    providerName = 'twilio';
  } else {
    // Not an SMS event — acknowledge so carrier doesn't retry
    return NextResponse.json({ received: true }, { status: 200 });
  }

  if (!toNumber || !fromNumber) {
    console.warn('[telnyx-sms] missing to/from in payload:', raw);
    return NextResponse.json({ error: 'Missing to/from' }, { status: 400 });
  }

  console.log(`[telnyx-sms] ${providerName} inbound: ${fromNumber} → ${toNumber}, body="${text.substring(0,50)}", payload keys=${Object.keys(raw).slice(0,10).join(',')}`);

  const supabase = getSupabaseAdmin();

  // Map the destination number to a tenant
  const { data: phoneNumber } = await supabase
    .from('calldesk_phone_numbers')
    .select('tenant_id, id')
    .eq('number', toNumber)
    .maybeSingle();

  if (!phoneNumber) {
    // Number not in our DB — acknowledge so Telnyx doesn't retry, but log
    console.warn('[telnyx-sms] number not found:', toNumber);
    return NextResponse.json({ received: true, note: 'number not registered' }, { status: 200 });
  }

  const tenantId = phoneNumber.tenant_id;

  const { data: sms, error } = await supabase
    .from('calldesk_sms_messages')
    .insert({
      tenant_id: tenantId,
      phone_number_id: phoneNumber.id,
      from_number: fromNumber,
      to_number: toNumber,
      body: text,
      direction: 'inbound',
      status: 'received',
      provider_sid: providerMessageId,
      provider: providerName,
    })
    .select()
    .single();

  if (error) {
    console.error('[telnyx-sms] failed to insert:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // --- STOP/HELP handling (carrier-required keywords) — short-circuit before
  // dispatching tenant webhooks or forwarding to the trial flow. This is the
  // general inbound path for ALL CallDesk numbers, not just the trial number.
  if (isStopKeyword(text) || isHelpKeyword(text)) {
    const replyBody = isStopKeyword(text) ? STOP_CONFIRMATION_TEXT : HELP_TEXT;
    if (isStopKeyword(text)) {
      await recordOptOut(fromNumber, 'telnyx-sms');
    }

    if (providerName === 'twilio') {
      const escaped = replyBody.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`,
        { status: 200, headers: { 'Content-Type': 'text/xml' } },
      );
    }

    const provider = getSmsProvider();
    const sendResult = await provider.send({ from: toNumber, to: fromNumber, body: replyBody });
    if (sendResult.error) {
      console.error('[telnyx-sms] stop/help reply failed:', sendResult.error);
    }
    await supabase.from('calldesk_sms_messages').insert({
      tenant_id: tenantId,
      phone_number_id: phoneNumber.id,
      from_number: toNumber,
      to_number: fromNumber,
      body: replyBody,
      direction: 'outbound',
      status: sendResult.status,
      error: sendResult.error,
    });
    return NextResponse.json({ received: true, id: sms.id, autoReplied: true }, { status: 200 });
  }

  // Fire tenant webhooks for sms.received
  try {
    await dispatchWebhookEvent(tenantId, 'sms.received', {
      sms: sms,
      from: fromNumber,
      to: toNumber,
      body: text,
      direction: 'inbound',
    });
  } catch (e) {
    console.error('[telnyx-sms] webhook dispatch failed:', e);
  }

  // If this is the trial onboarding number, pass to the trial handler
  const trialNumber = process.env.TRIAL_ONBOARDING_NUMBER;
  if (trialNumber && toNumber === normalizeE164(trialNumber)) {
    try {
      const host = request.headers.get('host') || 'calldesk.tech';
      const proto = request.headers.get('x-forwarded-proto') || 'https';
      const forwardUrl = `${proto}://${host}/api/webhooks/trial-sms`;
      console.log(`[telnyx-sms] forwarding to ${forwardUrl}`);
      const resp = await fetch(forwardUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...internalForwardHeaders() },
        body: JSON.stringify({
          from: fromNumber,
          to: toNumber,
          body: text,
        }),
      });
      const respBody = await resp.text();
      console.log(`[telnyx-sms] trial-sms response: ${resp.status} ${respBody.slice(0,200)}`);
    } catch (e) {
      console.error('[telnyx-sms] trial-sms forward failed:', e);
    }
  }

  if (providerName === 'twilio') {
    // Twilio expects TwiML XML for SMS webhooks, not JSON
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  return NextResponse.json({ received: true, id: sms.id }, { status: 200 });
}

function normalizeE164(num: unknown): string | null {
  if (typeof num !== 'string') return null;
  const digits = num.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.startsWith('+')) return num.trim();
  return null;
}
