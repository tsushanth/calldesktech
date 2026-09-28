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
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Telnyx wraps the event in data.event_type / data.payload
  const eventType = body?.data?.event_type;
  const payload = body?.data?.payload;

  if (eventType !== 'message.received' || !payload) {
    return NextResponse.json({ received: true }, { status: 200 }); // acknowledge non-SMS events
  }

  const toNumber = normalizeE164(payload.to);
  const fromNumber = normalizeE164(payload.from);
  const text = payload.text || '';
  const providerMessageId = payload.id || body?.data?.id;

  if (!toNumber || !fromNumber) {
    console.warn('[telnyx-sms] missing to/from in payload:', payload);
    return NextResponse.json({ error: 'Missing to/from' }, { status: 400 });
  }

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
      provider: 'telnyx',
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
