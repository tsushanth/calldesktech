import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient, RetellApiError } from '@/lib/retell';
import { checkPaymentMethodOnFile } from '@/lib/paymentMethodGate';
import { isPocEngine } from '@/lib/voiceEngine';
import { authorizeTenant } from '@/lib/authz';
import {
  DEFAULT_NUMBER_CARRIER,
  NUMBER_ADDON_PRICES,
  NumberAddOnNotConfiguredError,
  isNumberCarrier,
  numberAddOnTerms,
  requireNumberPriceIds,
  NUMBER_CARRIERS,
  type NumberCarrier,
} from '@/lib/numberAddOn';
import { billedNumberCount, setNumberAddOnCount, tenantNumberPlan } from '@/lib/numberAddOnBilling';

// Populous US area codes essentially guaranteed to have inventory — used as
// retry candidates when the requested/inferred area code comes back empty,
// before finally falling back to no area code at all (national inventory).
const FALLBACK_AREA_CODES = ['212', '415', '312', '404'];

const DEFAULT_AREA_CODE = '415';

// Buys a number on call-loop-poc's OWN Twilio account (not Retell's) and
// points its Voice webhook at call-loop-poc's own /twilio/voice — required
// for a poc-engine tenant's real inbound calls to work at all, and the
// counterpart of the retell-engine branch below purchasing through Retell.
// This route used to unconditionally require tenant.retell_agent_id and buy
// through Retell for every tenant, which meant a poc-engine tenant (the
// default for every new workspace and every dashboard-created agent) could
// never buy a number at all — every attempt 400'd with "no Retell agent".
async function purchaseViaPoc(areaCode: string | undefined, carrier: NumberCarrier): Promise<{ phoneNumber: string } | { error: string; status: number }> {
  const baseUrl = process.env.CALL_LOOP_POC_BASE_URL;
  const secret = process.env.CALL_LOOP_POC_TEST_CALL_SECRET;
  if (!baseUrl || !secret) {
    return { error: 'CALL_LOOP_POC_BASE_URL/CALL_LOOP_POC_TEST_CALL_SECRET not configured', status: 500 };
  }
  try {
    const res = await fetch(`${baseUrl}/purchase-number`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ areaCode, carrier }),
    });
    const body = await res.json();
    if (!res.ok) {
      return { error: body.error || 'call-loop-poc rejected the purchase', status: res.status };
    }
    return { phoneNumber: body.phone_number };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to reach call-loop-poc', status: 502 };
  }
}

// POST /api/tenants/[id]/phone-numbers/purchase — buy a real number and wire
// it up to actually receive calls. Lite and Standard tenants buy it as the premium number add-on (src/lib/numberAddOn.ts): the body must
// carry acceptNumberAddOn: true, the Stripe items are attached BEFORE the purchase and rolled back if it fails, and the route fails closed
// when the add-on's Stripe prices are not configured. Pro and legacy flat-rate tenants (created before the tiers launched, no tiered agent): numbers included and never charged. Any other tenant, including a new one with no tiered agent yet, buys it as the add-on. Distinct from POST
// /api/tenants/[id]/phone-numbers, which only registers a number the caller
// already owns and never spends money.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

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

  const body = await request.json().catch(() => ({}));
  const requestedAreaCode: string | undefined = body.areaCode;
  const settings = (tenant.settings ?? {}) as { phone?: string; address?: string; voice_engine?: string };

  const carrier = body.carrier ?? DEFAULT_NUMBER_CARRIER;
  if (!isNumberCarrier(carrier)) {
    return NextResponse.json({ error: `Unknown carrier "${String(carrier)}". Valid: ${NUMBER_CARRIERS.join(', ')}` }, { status: 400 });
  }

  let plan;
  try {
    plan = await tenantNumberPlan(supabase, tenantId);
  } catch (err) {
    // Cannot tell whether this tenant pays: do not buy a number that might go unbilled.
    console.error('Could not determine number add-on plan', { tenantId }, err);
    return NextResponse.json({ error: 'Could not check your plan, so no number was bought. Try again.', code: 'number_plan_check_failed' }, { status: 503 });
  }

  let billedBefore: number | null = null; // set once the add-on's Stripe items are attached
  if (plan.kind === 'addon') {
    if (body.acceptNumberAddOn !== true) {
      const price = NUMBER_ADDON_PRICES[carrier];
      return NextResponse.json(
        {
          error: `Buying a phone number from us is a paid add-on: ${numberAddOnTerms(carrier)} Pass acceptNumberAddOn: true to confirm, or bring your own number instead.`,
          code: 'number_addon_acceptance_required',
          terms: numberAddOnTerms(carrier),
          carrier,
          monthlyCents: price.monthlyCents,
          inboundCentsPerMinute: price.inboundCentsPerMinute,
        },
        { status: 400 }
      );
    }
    if (!isPocEngine(settings)) {
      return NextResponse.json({ error: 'Premium phone numbers are available on the in-house voice engine only.', code: 'number_addon_engine_unsupported' }, { status: 400 });
    }
    try {
      requireNumberPriceIds(carrier);
    } catch (err) {
      if (err instanceof NumberAddOnNotConfiguredError) {
        console.error('Number add-on billing not configured', err.missing);
        return NextResponse.json({ error: 'Premium phone numbers are not available yet. No number was bought and nothing was charged.', code: 'number_addon_not_configured' }, { status: 503 });
      }
      throw err;
    }
    try {
      billedBefore = await billedNumberCount(supabase, tenantId, carrier);
      const attached = await setNumberAddOnCount(supabase, tenantId, carrier, billedBefore + 1);
      if (attached.status === 'no_subscription') {
        return NextResponse.json(
          { error: 'Start your subscription before buying a phone number.', action: 'checkout' },
          { status: 402 }
        );
      }
    } catch (err) {
      console.error('Failed to attach number add-on billing', { tenantId, carrier }, err);
      return NextResponse.json(
        { error: 'Could not set up billing for the phone number, so none was bought. No charge was made; trying again is safe.', code: 'number_addon_billing_failed', retryable: true },
        { status: 502 }
      );
    }
  }

  // Undoes the Stripe change when the purchase itself fails (idempotent: sets the absolute count from before).
  const rollbackBilling = async () => {
    if (billedBefore === null) return;
    try {
      await setNumberAddOnCount(supabase, tenantId, carrier, billedBefore);
    } catch (err) {
      console.error('FAILED to roll back number add-on billing after a failed purchase; reconcile by hand', { tenantId, carrier, billedBefore }, err);
    }
  };

  let phoneNumber: string | null = null;

  if (isPocEngine(settings)) {
    const result = await purchaseViaPoc(requestedAreaCode || inferAreaCode(settings.phone) || DEFAULT_AREA_CODE, carrier);
    if ('error' in result) {
      await rollbackBilling();
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    phoneNumber = result.phoneNumber;
  } else {
    if (!tenant.retell_agent_id) {
      return NextResponse.json(
        { error: 'This tenant has no Retell agent to assign the number to.' },
        { status: 400 }
      );
    }

    const inferredAreaCode = inferAreaCode(settings.phone);
    const candidates = [
      requestedAreaCode,
      inferredAreaCode,
      DEFAULT_AREA_CODE,
      ...FALLBACK_AREA_CODES,
      undefined, // final fallback: no area code, let Retell pick from national inventory
    ].filter((v, i, arr) => arr.indexOf(v) === i); // dedupe, preserves order

    const retell = getRetellClient();
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

    try {
      await retell.assignPhoneNumberToAgent(phoneNumber, tenant.retell_agent_id);
    } catch (err) {
      // The number is already purchased and billed at this point — don't lose
      // track of it just because assignment failed; surface it as JSON instead
      // of letting the exception bubble into an empty-body 500.
      const message = err instanceof Error ? err.message : 'Failed to assign number to agent';
      console.error('Phone number purchased but failed to assign to agent:', err);
      return NextResponse.json(
        { phoneNumber, warning: `Purchased but not assigned to agent: ${message}` },
        { status: 201 }
      );
    }
  }

  const { data: numberRow, error: insertError } = await supabase
    .from('calldesk_phone_numbers')
    .insert({
      tenant_id: tenantId,
      number: phoneNumber,
      ...(plan.kind === 'addon' ? { source: 'purchased', carrier, addon_billed: true } : {}),
    })
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

  // Two purchases at once each computed their target from the same count; settle on the real count now (best effort, idempotent).
  if (billedBefore !== null) {
    try {
      await setNumberAddOnCount(supabase, tenantId, carrier, await billedNumberCount(supabase, tenantId, carrier));
    } catch (err) {
      console.error('Number add-on billing reconcile failed after purchase', { tenantId, carrier }, err);
    }
  }

  return NextResponse.json({ phoneNumber: numberRow }, { status: 201 });
}

function inferAreaCode(phone?: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  // Strip a leading US country code (1) if present, then take the first 3.
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return local.length >= 3 ? local.slice(0, 3) : undefined;
}
