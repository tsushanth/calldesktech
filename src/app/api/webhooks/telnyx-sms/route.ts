import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { dispatchWebhookEvent } from '@/lib/webhooks';

// POST /api/webhooks/telnyx-sms — receives inbound SMS from Telnyx.
// Unauthenticated (called by Telnyx servers). We map the "to" number back
// to a tenant via calldesk_phone_numbers and record the message.
//
// TODO: add Telnyx signature verification once we have a public key API
// (requires fetching the public key from Telnyx and verifying the
// Telnyx-Signature-Ed25519 header against raw request body).
export async function POST(request: NextRequest) {
  let raw: any = {};

  // Clone because json() consumes the body
  const clone = request.clone();

  // Try JSON first (Telnyx)
  try {
    raw = await request.json();
  } catch {
    try {
      // Fall back to form-encoded (Twilio)
      const text = await clone.text();
      const params = new URLSearchParams(text);
      const obj: Record<string, string> = {};
      params.forEach((v, k) => { obj[k] = v; });
      raw = obj;
    } catch (e) {
      console.error('[telnyx-sms] Cannot parse body:', e);
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
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
    // Telnyx
    toNumber = normalizeE164(payload.to);
    fromNumber = normalizeE164(payload.from);
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
      await fetch(`${proto}://${host}/api/webhooks/trial-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromNumber,
          to: toNumber,
          body: text,
        }),
      });
      console.log('[telnyx-sms] forwarded to trial-sms handler');
    } catch (e) {
      console.error('[telnyx-sms] trial-sms forward failed:', e);
    }
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
