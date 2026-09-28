import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';
import { isPocEngine } from '@/lib/voiceEngine';

// GET /api/tenants/[id]/phone-numbers/available — search purchasable numbers.
// Twilio (poc engine): uses Twilio's AvailablePhoneNumbers API.
// Retell (retell engine): Retell has no search — just auto-assigns on
// purchase. Returns a helpful message directing to /purchase instead.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const { searchParams } = new URL(request.url);
  const areaCode = searchParams.get('areaCode') || undefined;
  const type = (searchParams.get('type') as 'local' | 'toll_free' | 'mobile') || 'local';

  const supabase = getSupabaseAdmin();
  const { data: tenant } = await supabase
    .from('calldesk_tenants')
    .select('settings')
    .eq('id', tenantId)
    .single();

  if (tenant && !isPocEngine(tenant.settings)) {
    return NextResponse.json({
      message: 'Retell numbers are auto-assigned on purchase. Use buy_number (POST /phone-numbers/purchase) with an areaCode instead.',
      numbers: [],
    });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return NextResponse.json({ error: 'Twilio credentials not configured' }, { status: 500 });
  }

  const auth64 = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  // Twilio AvailablePhoneNumber resource: /AvailablePhoneNumbers/{country}/Local.json
  const country = 'US';
  const numberType = type === 'toll_free' ? 'TollFree' : 'Local';
  let twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/AvailablePhoneNumbers/${country}/${numberType}.json`;
  const qp = new URLSearchParams();
  if (areaCode) qp.set('AreaCode', areaCode);
  if (qp.toString()) twilioUrl += `?${qp.toString()}`;

  try {
    const res = await fetch(twilioUrl, { headers: { Authorization: `Basic ${auth64}` } });
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({ error: `Twilio search failed: ${body}` }, { status: 502 });
    }
    const data = await res.json() as { available_phone_numbers?: { friendly_name: string; phone_number: string; lata: string; rate_center: string; latitude: string; longitude: string; region: string; postal_code: string; iso_country: string; address_requirements: string; beta: boolean; capabilities: { voice: boolean; SMS: boolean; MMS: boolean } }[] };
    const numbers = (data.available_phone_numbers || []).map((n) => ({
      phoneNumber: n.phone_number,
      friendlyName: n.friendly_name,
      locality: n.rate_center,
      region: n.region,
      type,
      capabilities: n.capabilities,
    }));
    return NextResponse.json({ numbers });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Search failed' }, { status: 502 });
  }
}