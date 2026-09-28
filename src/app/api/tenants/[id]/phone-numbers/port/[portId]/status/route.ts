import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

// GET https://numbers.twilio.com/v1/Porting/PortIn/{PortInRequestSid}
//
// Twilio's docs (Porting webhooks page, public beta) describe a webhook
// notification for port status changes, but this repo does not implement a
// webhook receiver for it — building a signed webhook endpoint is a
// separate piece of infrastructure (route + signature verification) beyond
// this pass's scope, and the porting-webhooks doc wasn't inspected closely
// enough here to be certain of its payload/signing shape. This route is a
// manual "check status" poll instead, which the SDK-less REST docs clearly
// support and which the dashboard's "Check status" button calls on demand.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; portId: string }> }
) {
  const { id: tenantIdParam, portId } = await params;
  const __auth = await authorizeTenant(request, tenantIdParam);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();

  const { data: port, error: fetchError } = await supabase
    .from('phone_number_ports')
    .select('*')
    .eq('id', portId)
    .eq('tenant_id', tenantId)
    .single();
  if (fetchError || !port) {
    return NextResponse.json({ error: 'Port request not found' }, { status: 404 });
  }
  if (!port.twilio_port_in_request_sid) {
    return NextResponse.json({ port });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return NextResponse.json({ error: 'Twilio credentials not configured' }, { status: 500 });
  }
  const auth64 = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  try {
    const res = await fetch(
      `https://numbers.twilio.com/v1/Porting/PortIn/${port.twilio_port_in_request_sid}`,
      { headers: { Authorization: `Basic ${auth64}` } }
    );
    const responseBody = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (responseBody as { message?: string }).message || `Twilio status check failed: ${res.status}`;
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const data = responseBody as { port_in_request_status?: string };
    const { data: updated, error: updateError } = await supabase
      .from('phone_number_ports')
      .update({
        status: data.port_in_request_status ?? port.status,
        last_status_response: responseBody,
      })
      .eq('id', port.id)
      .select()
      .single();
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    return NextResponse.json({ port: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Status check failed' }, { status: 502 });
  }
}
