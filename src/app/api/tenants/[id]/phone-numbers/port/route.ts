import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

// Twilio's Porting API is REST-only (public beta) — there is no `twilio` npm
// SDK installed in this repo (confirmed: not in package.json, no
// node_modules/twilio), and this codebase's existing Twilio integrations
// (src/lib/smsProvider.ts, .../phone-numbers/available/route.ts) all call
// the REST API directly with Basic auth, so this follows that same pattern
// rather than introducing an SDK dependency.
//
// Endpoint verified against Twilio's docs (numbers.twilio.com host, distinct
// from the api.twilio.com 2010-04-01 host used elsewhere in this repo):
//   POST https://numbers.twilio.com/v1/Porting/PortIn
// Response includes `port_in_request_sid` and `port_in_request_status`.
const PORTING_API_BASE = 'https://numbers.twilio.com/v1/Porting/PortIn';

function twilioAuthHeader(): string | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
}

// GET /api/tenants/[id]/phone-numbers/port — list this tenant's port requests
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('phone_number_ports')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ports: data });
}

// POST /api/tenants/[id]/phone-numbers/port — submit a real port-in request
// to Twilio and store the resulting request id + status.
//
// NOTE on required fields: Twilio's PortIn create call also requires at
// least one `documents` entry (a Utility Bill document SID, uploaded via a
// separate Document resource this repo does not implement — that's document
// upload/LOA bureaucracy, out of scope per spec). If document_sids isn't
// supplied, submission will fail at Twilio; that failure is stored as
// status 'submit_failed' with the Twilio error message, not silently
// swallowed, so the caller can see exactly why.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const body = await request.json();
  const {
    number,
    losingCarrierName,
    customerType,
    authorizedRepresentative,
    authorizedRepresentativeEmail,
    accountTelephoneNumber,
    accountNumber,
    billingAddress,
    documentSids,
    targetPortInDate,
    notificationEmails,
  } = body;

  if (!number) {
    return NextResponse.json({ error: 'number is required (E.164 format)' }, { status: 400 });
  }
  if (!customerType || !authorizedRepresentative || !authorizedRepresentativeEmail || !accountTelephoneNumber) {
    return NextResponse.json({
      error: 'customerType, authorizedRepresentative, authorizedRepresentativeEmail, and accountTelephoneNumber are required by Twilio\'s losing_carrier_information',
    }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Insert a draft row first so we always have a local record, even if the
  // Twilio call fails.
  const { data: draft, error: draftError } = await supabase
    .from('phone_number_ports')
    .insert({
      tenant_id: tenantId,
      number,
      status: 'draft',
      losing_carrier_name: losingCarrierName ?? null,
      customer_type: customerType,
      authorized_representative: authorizedRepresentative,
      authorized_representative_email: authorizedRepresentativeEmail,
      account_telephone_number: accountTelephoneNumber,
      account_number: accountNumber ?? null,
      billing_address: billingAddress ?? {},
      document_sids: documentSids ?? [],
      target_port_in_date: targetPortInDate ?? null,
      notification_emails: notificationEmails ?? [],
    })
    .select()
    .single();
  if (draftError) return NextResponse.json({ error: draftError.message }, { status: 500 });

  const authHeader = twilioAuthHeader();
  if (!authHeader) {
    await supabase
      .from('phone_number_ports')
      .update({ status: 'submit_failed', last_submit_error: 'Twilio credentials not configured' })
      .eq('id', draft.id);
    return NextResponse.json({ error: 'Twilio credentials not configured' }, { status: 500 });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const payload: Record<string, unknown> = {
    account_sid: accountSid,
    phone_numbers: [{ phone_number: number }],
    documents: documentSids ?? [],
    losing_carrier_information: {
      customer_name: losingCarrierName ?? authorizedRepresentative,
      customer_type: customerType,
      authorized_representative: authorizedRepresentative,
      authorized_representative_email: authorizedRepresentativeEmail,
      account_telephone_number: accountTelephoneNumber,
    },
  };
  if (accountNumber) payload.account_number = accountNumber;
  if (billingAddress) payload.address = billingAddress;
  if (targetPortInDate) payload.target_port_in_date = targetPortInDate;
  if (notificationEmails) payload.notification_emails = notificationEmails;

  try {
    const res = await fetch(PORTING_API_BASE, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const responseBody = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = (responseBody as { message?: string }).message || `Twilio porting request failed: ${res.status}`;
      await supabase
        .from('phone_number_ports')
        .update({ status: 'submit_failed', last_submit_error: msg, last_status_response: responseBody })
        .eq('id', draft.id);
      return NextResponse.json({ error: msg, port: { ...draft, status: 'submit_failed', last_submit_error: msg } }, { status: 502 });
    }

    const data = responseBody as { port_in_request_sid?: string; port_in_request_status?: string };
    const { data: updated, error: updateError } = await supabase
      .from('phone_number_ports')
      .update({
        twilio_port_in_request_sid: data.port_in_request_sid ?? null,
        status: data.port_in_request_status ?? 'In progress',
        last_status_response: responseBody,
        last_submit_error: null,
      })
      .eq('id', draft.id)
      .select()
      .single();
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    return NextResponse.json({ port: updated }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Twilio porting request failed';
    await supabase
      .from('phone_number_ports')
      .update({ status: 'submit_failed', last_submit_error: msg })
      .eq('id', draft.id);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
