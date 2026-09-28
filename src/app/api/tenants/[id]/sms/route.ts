import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

// POST /api/tenants/[id]/sms — send an SMS from one of the tenant's
// phone numbers via Twilio. Requires TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN.
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

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return NextResponse.json({ error: 'Twilio credentials not configured' }, { status: 500 });
  }

  // Send via Twilio Messages API
  const auth64 = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const form = new URLSearchParams();
  form.set('From', phoneNumber.number);
  form.set('To', toNumber);
  form.set('Body', messageBody);

  let twilioSid: string | null = null;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth64}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const body = await res.json() as { sid?: string; error_message?: string };
    if (!res.ok) {
      return NextResponse.json({ error: body.error_message || `Twilio error: ${res.status}` }, { status: 502 });
    }
    twilioSid = body.sid ?? null;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Twilio request failed' }, { status: 502 });
  }

  const { data, error } = await supabase
    .from('calldesk_sms_messages')
    .insert({
      tenant_id: tenantId,
      phone_number_id: phoneNumberId,
      from_number: phoneNumber.number,
      to_number: toNumber,
      body: messageBody,
      direction: 'outbound',
      status: 'queued',
      provider_sid: twilioSid,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
