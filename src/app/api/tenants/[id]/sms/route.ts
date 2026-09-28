import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';
import { getSmsProvider } from '@/lib/smsProvider';
import { dispatchWebhookEvent } from '@/lib/webhooks';
import { isOptedOut } from '@/lib/smsOptOut';

// POST /api/tenants/[id]/sms — send an SMS from one of the tenant's
// phone numbers via the configured SMS provider (Telnyx, Twilio, or noop).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;
  const tenantId = (await params).id;

  const { phoneNumberId, toNumber, body: messageBody } = await request.json();
  if (!phoneNumberId || !toNumber || !messageBody) {
    return NextResponse.json({ error: 'phoneNumberId, toNumber, and body are required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: phoneNumber } = await supabase
    .from('calldesk_phone_numbers')
    .select('number')
    .eq('id', phoneNumberId)
    .eq('tenant_id', tenantId)
    .single();
  if (!phoneNumber) {
    return NextResponse.json({ error: 'Phone number not found for this tenant' }, { status: 404 });
  }

  // Carrier/10DLC compliance: never send to a number that has opted out via
  // STOP/CANCEL/END/QUIT/UNSUBSCRIBE, regardless of which sender triggered this.
  if (await isOptedOut(toNumber)) {
    return NextResponse.json({ error: 'Recipient has opted out of SMS' }, { status: 422 });
  }

  const provider = getSmsProvider();
  const sendResult = await provider.send({
    from: phoneNumber.number,
    to: toNumber,
    body: messageBody,
  });

  const { data, error } = await supabase
    .from('calldesk_sms_messages')
    .insert({
      tenant_id: tenantId,
      phone_number_id: phoneNumberId,
      from_number: phoneNumber.number,
      to_number: toNumber,
      body: messageBody,
      direction: 'outbound',
      status: sendResult.status,
      provider_sid: sendResult.providerSid,
      error: sendResult.error,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fire tenant webhooks for sms.sent
  try {
    await dispatchWebhookEvent(tenantId, 'sms.sent', {
      sms: data,
      from: phoneNumber.number,
      to: toNumber,
      body: messageBody,
      direction: 'outbound',
    });
  } catch (e) {
    console.error('[sms] webhook dispatch failed:', e);
  }

  if (sendResult.error) {
    return NextResponse.json({ error: sendResult.error, sms: data }, { status: 502 });
  }
  return NextResponse.json({ sms: data }, { status: 201 });
}

// GET /api/tenants/[id]/sms — list SMS messages for the tenant.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;
  const tenantId = (await params).id;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '25', 10), 200);
  const phoneNumberId = searchParams.get('phoneNumberId');

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('calldesk_sms_messages')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (phoneNumberId) query = query.eq('phone_number_id', phoneNumberId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ smsMessages: data || [] });
}
