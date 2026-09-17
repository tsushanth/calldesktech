import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient, RetellApiError } from '@/lib/retell';
import { checkPaymentMethodOnFile } from '@/lib/paymentMethodGate';

// Populous US area codes essentially guaranteed to have inventory — used as
// retry candidates when the requested/inferred area code comes back empty,
// before finally falling back to no area code at all (national inventory).
const FALLBACK_AREA_CODES = ['212', '415', '312', '404'];

const DEFAULT_AREA_CODE = '415';

// POST /api/tenants/[id]/phone-numbers/purchase — buy a real number via
// Retell (which wraps Twilio) and assign it to the tenant's agent. Distinct
// from POST /api/tenants/[id]/phone-numbers, which only registers a number
// the caller already owns and never spends money.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();

  const gate = await checkPaymentMethodOnFile(tenantId);
  if (!gate.ok) {
    return NextResponse.json(
      {
        error:
          gate.reason === 'no_stripe_customer'
            ? 'Add billing before buying a phone number.'
            : 'Add a payment method before buying a phone number.',
        action: gate.action,
      },
      { status: 402 }
    );
  }

  const { data: tenant, error: tenantError } = await supabase
    .from('calldesk_tenants')
    .select('retell_agent_id, settings')
    .eq('id', tenantId)
    .single();

  if (tenantError || !tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }
  if (!tenant.retell_agent_id) {
    return NextResponse.json(
      { error: 'This tenant has no Retell agent to assign the number to.' },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const requestedAreaCode: string | undefined = body.areaCode;

  const settings = (tenant.settings ?? {}) as { phone?: string; address?: string };
  const inferredAreaCode = inferAreaCode(settings.phone);

  const candidates = [
    requestedAreaCode,
    inferredAreaCode,
    DEFAULT_AREA_CODE,
    ...FALLBACK_AREA_CODES,
    undefined, // final fallback: no area code, let Retell pick from national inventory
  ].filter((v, i, arr) => arr.indexOf(v) === i); // dedupe, preserves order

  const retell = getRetellClient();
  let phoneNumber: string | null = null;
  let lastError: unknown = null;

  for (const areaCode of candidates) {
    try {
      const result = await retell.purchasePhoneNumber(areaCode);
      phoneNumber = result.phone_number;
      break;
    } catch (err) {
      lastError = err;
      if (err instanceof RetellApiError && err.status === 404) {
        continue; // no numbers in this area code — try the next candidate
      }
      // Any other error (400/401/500) is a real failure, not "try elsewhere".
      break;
    }
  }

  if (!phoneNumber) {
    const message = lastError instanceof Error ? lastError.message : 'Failed to purchase a phone number';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  await retell.assignPhoneNumberToAgent(phoneNumber, tenant.retell_agent_id);

  const { data: numberRow, error: insertError } = await supabase
    .from('calldesk_phone_numbers')
    .insert({ tenant_id: tenantId, number: phoneNumber })
    .select()
    .single();

  if (insertError) {
    // The purchase + Retell assignment already succeeded — don't pretend it
    // didn't just because our own row failed to write.
    console.error('Phone number purchased but failed to record in Supabase:', insertError);
    return NextResponse.json(
      { phoneNumber, warning: `Purchased but failed to save: ${insertError.message}` },
      { status: 201 }
    );
  }

  await supabase.from('calldesk_tenants').update({ phone_number: phoneNumber }).eq('id', tenantId);

  return NextResponse.json({ phoneNumber: numberRow }, { status: 201 });
}

function inferAreaCode(phone?: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  // Strip a leading US country code (1) if present, then take the first 3.
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return local.length >= 3 ? local.slice(0, 3) : undefined;
}
