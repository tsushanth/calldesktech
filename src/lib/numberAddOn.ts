import type { TierId } from '@/lib/pricingTiers';
import { isTierId } from '@/lib/pricingTiers';

// Premium phone numbers: an add-on for the bring-your-own-carrier tiers. A Lite or Standard customer may buy a number from us instead of
// bringing their own, on our Twilio ("premium") or Telnyx ("value") carrier, billed per month per number plus a per-minute amount for
// INBOUND calls to those numbers (the carrier surcharge, on top of the plan's per-minute price). Outbound stays
// bring-your-own carrier: it is neither provided nor billed here.
//
// Pro includes phone service, so Pro is never charged for a number (see numberPlanForTiers).
//
// Two carriers: Twilio (premium, $2.00 + 1.5 cents) and Telnyx (value, $1.00 + 1 cent). Each has its own Stripe prices and inbound meter,
// so a customer holding numbers on both is billed each correctly. To add a carrier, extend NumberCarrier and fill in NUMBER_ADDON_PRICES,
// NUMBER_PRICE_ENV and NUMBER_INBOUND_METER_EVENT for it.
//
// Customer-facing prices only.

export type NumberCarrier = 'twilio' | 'telnyx';
export const NUMBER_CARRIERS: readonly NumberCarrier[] = ['twilio', 'telnyx'];
export const DEFAULT_NUMBER_CARRIER: NumberCarrier = 'twilio';

/** The tiers that buy a number as a paid add-on. Pro is deliberately absent (numbers included). To make Pro pay too, add 'pro' here and nowhere else. */
export const NUMBER_ADDON_TIERS: readonly TierId[] = ['lite', 'standard'];

export type NumberCarrierPrice = {
  /** Customer-facing label. */
  label: string;
  /** Cents per month for each number. */
  monthlyCents: number;
  /** Cents per minute of inbound calls to the carrier's numbers (may be fractional). */
  inboundCentsPerMinute: number;
};

export const NUMBER_ADDON_PRICES: Record<NumberCarrier, NumberCarrierPrice> = {
  twilio: { label: 'Twilio carrier (premium)', monthlyCents: 200, inboundCentsPerMinute: 1.5 },
  telnyx: { label: 'Telnyx carrier (value)', monthlyCents: 100, inboundCentsPerMinute: 1 },
};

/** Stripe price env vars per carrier: a licensed monthly price (quantity = numbers) and a metered inbound price (reported in whole seconds). */
export const NUMBER_PRICE_ENV: Record<NumberCarrier, { monthly: string; inbound: string }> = {
  twilio: { monthly: 'STRIPE_PRICE_NUMBER_TWILIO_MONTHLY', inbound: 'STRIPE_PRICE_NUMBER_TWILIO_INBOUND' },
  telnyx: { monthly: 'STRIPE_PRICE_NUMBER_TELNYX_MONTHLY', inbound: 'STRIPE_PRICE_NUMBER_TELNYX_INBOUND' },
};

/** Stripe meter event name per carrier for inbound seconds. Same unit and customer mapping as the voice meters. */
export const NUMBER_INBOUND_METER_EVENT: Record<NumberCarrier, string> = {
  twilio: 'calldesktech_number_inbound_seconds_twilio',
  telnyx: 'calldesktech_number_inbound_seconds_telnyx',
};

export function isNumberCarrier(v: unknown): v is NumberCarrier {
  return typeof v === 'string' && (NUMBER_CARRIERS as readonly string[]).includes(v);
}

/** A stored carrier value: null (the column is nullable) means Twilio, per migration 066. An unknown carrier returns null. */
export function carrierOfRow(v: unknown): NumberCarrier | null {
  if (v === null || v === undefined || v === '') return DEFAULT_NUMBER_CARRIER;
  return isNumberCarrier(v) ? v : null;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
function centsText(c: number): string {
  return `${c} cent${c === 1 ? '' : 's'}`;
}

export function numberAddOnTerms(carrier: NumberCarrier = DEFAULT_NUMBER_CARRIER): string {
  const p = NUMBER_ADDON_PRICES[carrier];
  return `${dollars(p.monthlyCents)} per month for each number, plus ${centsText(p.inboundCentsPerMinute)} per minute of inbound calls to your purchased numbers (${carrier === 'telnyx' ? 'Telnyx' : 'Twilio'} carrier charge), added to your plan's per-minute price. Outbound calls use your own carrier and are not billed here.`;
}

export type NumberPlan = { kind: 'included' } | { kind: 'addon' };

/**
 * Whether a tenant pays for a purchased number, from the tiers of its agents' latest versions (null = a version published without a tier).
 *   - Any Pro agent: included. Pro is never charged, even next to Lite or Standard agents.
 *   - Otherwise any tier in NUMBER_ADDON_TIERS (Lite, Standard): add-on.
 *   - No tiered agent at all (new tenant, or legacy flat-price agents): included. Legacy plans already include phone service, so charging
 *     them would be a repricing, and blocking them would break existing behaviour. Conservative on purpose: never charges Pro, never blocks.
 * Mixed Standard/Lite and legacy agents count as add-on, and the customer must accept the terms explicitly before being charged.
 */
export function numberPlanForTiers(tiers: Array<string | null | undefined>): NumberPlan {
  const known = tiers.filter(isTierId);
  if (known.includes('pro')) return { kind: 'included' };
  if (known.some((t) => (NUMBER_ADDON_TIERS as readonly string[]).includes(t))) return { kind: 'addon' };
  return { kind: 'included' };
}

export class NumberAddOnNotConfiguredError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Premium phone numbers are not available yet: billing is not configured (${missing.join(', ')}).`);
    this.name = 'NumberAddOnNotConfiguredError';
  }
}

export type NumberPriceIds = { monthly: string; inbound: string };

/** Price ids for a carrier, or null when either env var is unset or blank. */
export function numberPriceIds(carrier: NumberCarrier): NumberPriceIds | null {
  const env = NUMBER_PRICE_ENV[carrier];
  const monthly = process.env[env.monthly]?.trim();
  const inbound = process.env[env.inbound]?.trim();
  return monthly && inbound ? { monthly, inbound } : null;
}

/** Price ids, or throws NumberAddOnNotConfiguredError naming the missing env vars (never their values). */
export function requireNumberPriceIds(carrier: NumberCarrier): NumberPriceIds {
  const ids = numberPriceIds(carrier);
  if (ids) return ids;
  const env = NUMBER_PRICE_ENV[carrier];
  throw new NumberAddOnNotConfiguredError([env.monthly, env.inbound].filter((n) => !process.env[n]?.trim()));
}

/** What the API and pages show about the add-on. */
export function publicNumberAddOn() {
  return {
    tiers: [...NUMBER_ADDON_TIERS],
    carriers: NUMBER_CARRIERS.map((c) => ({
      carrier: c,
      label: NUMBER_ADDON_PRICES[c].label,
      monthlyDollars: NUMBER_ADDON_PRICES[c].monthlyCents / 100,
      inboundCentsPerMinute: NUMBER_ADDON_PRICES[c].inboundCentsPerMinute,
      terms: numberAddOnTerms(c),
    })),
    note: 'Pro includes phone numbers. On Lite and Standard you can bring your own number or buy one from us on the premium Twilio carrier or the lower-priced Telnyx carrier. Outbound calling uses your own carrier.',
  };
}
