import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  NUMBER_ADDON_PRICES,
  NUMBER_ADDON_TIERS,
  NUMBER_INBOUND_METER_EVENT,
  NUMBER_PRICE_ENV,
  NumberAddOnNotConfiguredError,
  TIERS_LAUNCHED_AT,
  carrierOfRow,
  createdBeforeTiers,
  numberAddOnTerms,
  numberPlanForTiers,
  numberPriceIds,
  publicNumberAddOn,
  requireNumberPriceIds,
} from '@/lib/numberAddOn';
import { CARRIER_NOTE, PRICING_TIERS } from '@/lib/pricingTiers';
import { PHONE_NUMBERS_LINE } from '@/lib/pricingCopy';
import { compactMinute, meterEventIdentifier } from '@/lib/reportUsageToStripe';

describe('number add-on config', () => {
  it('customer prices: $2.00 per month per number and 1.5 cents per inbound minute on Twilio', () => {
    expect(NUMBER_ADDON_PRICES.twilio.monthlyCents).toBe(200);
    expect(NUMBER_ADDON_PRICES.twilio.inboundCentsPerMinute).toBe(1.5);
    expect(numberAddOnTerms('twilio')).toMatch(/\$2\.00 per month for each number/);
    expect(numberAddOnTerms('twilio')).toMatch(/1\.5 cents per minute of inbound/);
    expect(numberAddOnTerms('twilio')).toMatch(/Outbound calls use your own carrier/);
  });

  it('the carrier note says bring your own on every plan, and the displayed phone-number prices come from the config', () => {
    expect(CARRIER_NOTE).toBe('Bring your own carrier on every plan, or add phone numbers from us.');
    expect(PHONE_NUMBERS_LINE).toContain(`$${(NUMBER_ADDON_PRICES.twilio.monthlyCents / 100).toFixed(2)} per month plus ${NUMBER_ADDON_PRICES.twilio.inboundCentsPerMinute} cents per inbound minute`);
    expect(PHONE_NUMBERS_LINE).toContain(`$${(NUMBER_ADDON_PRICES.telnyx.monthlyCents / 100).toFixed(2)} per month plus ${NUMBER_ADDON_PRICES.telnyx.inboundCentsPerMinute} cent per inbound minute`);
  });

  it('Telnyx (value) prices: $1.00 per month per number and 1 cent per inbound minute', () => {
    expect(NUMBER_ADDON_PRICES.telnyx.monthlyCents).toBe(100);
    expect(NUMBER_ADDON_PRICES.telnyx.inboundCentsPerMinute).toBe(1);
    expect(numberAddOnTerms('telnyx')).toMatch(/\$1\.00 per month for each number/);
    expect(numberAddOnTerms('telnyx')).toMatch(/1 cent per minute of inbound/);
    expect(numberAddOnTerms('telnyx')).not.toMatch(/1 cents/);
  });

  it('maps each carrier to its Stripe price env vars and meter event', () => {
    expect(NUMBER_PRICE_ENV.twilio).toEqual({ monthly: 'STRIPE_PRICE_NUMBER_TWILIO_MONTHLY', inbound: 'STRIPE_PRICE_NUMBER_TWILIO_INBOUND' });
    expect(NUMBER_INBOUND_METER_EVENT.twilio).toBe('calldesktech_number_inbound_seconds_twilio');
    expect(NUMBER_PRICE_ENV.telnyx).toEqual({ monthly: 'STRIPE_PRICE_NUMBER_TELNYX_MONTHLY', inbound: 'STRIPE_PRICE_NUMBER_TELNYX_INBOUND' });
    expect(NUMBER_INBOUND_METER_EVENT.telnyx).toBe('calldesktech_number_inbound_seconds_telnyx');
  });

  it('the add-on tiers are every tier (all are bring-your-own carrier), Pro included', () => {
    expect([...NUMBER_ADDON_TIERS]).toEqual(PRICING_TIERS.map((t) => t.id));
    expect(NUMBER_ADDON_TIERS).toContain('pro');
  });

  it('the public payload carries no cost or margin wording', () => {
    expect(JSON.stringify(publicNumberAddOn())).not.toMatch(/cost|margin|wholesale|markup/i);
  });

  it('a null or empty stored carrier means twilio; an unknown carrier is not billable', () => {
    expect(carrierOfRow(null)).toBe('twilio');
    expect(carrierOfRow('twilio')).toBe('twilio');
    expect(carrierOfRow('telnyx')).toBe('telnyx');
    expect(carrierOfRow('vonage')).toBeNull();
  });

  it('inbound meter identifiers stay within 100 characters', () => {
    const id = meterEventIdentifier('bd6ee88b-bc62-4f65-a54c-3391322502c8', 'number_inbound_twilio', `${compactMinute(null)}_${compactMinute(new Date('2026-10-03T04:36:00Z'))}`);
    expect(id.length).toBeLessThanOrEqual(100);
  });
});

describe('numberPlanForTiers', () => {
  it('Lite, Standard and Pro all pay the add-on', () => {
    expect(numberPlanForTiers(['lite']).kind).toBe('addon');
    expect(numberPlanForTiers(['standard']).kind).toBe('addon');
    expect(numberPlanForTiers(['pro']).kind).toBe('addon');
    expect(numberPlanForTiers(['lite', 'standard']).kind).toBe('addon');
  });
  it('Pro pays even next to other agents, and a legacy flat-rate tenant that has a Pro agent pays too', () => {
    expect(numberPlanForTiers(['standard', 'pro']).kind).toBe('addon');
    expect(numberPlanForTiers(['lite', 'pro', null]).kind).toBe('addon');
    expect(numberPlanForTiers(['pro'], { legacyFlatRate: true }).kind).toBe('addon');
  });
  it('a genuine legacy flat-rate tenant (untiered, created before the tiers launched) is included', () => {
    expect(numberPlanForTiers([], { legacyFlatRate: true }).kind).toBe('included');
    expect(numberPlanForTiers([null, null], { legacyFlatRate: true }).kind).toBe('included');
    expect(numberPlanForTiers(['bogus'], { legacyFlatRate: true }).kind).toBe('included');
  });
  it('a new tenant with no tiered agent pays the add-on (not free)', () => {
    expect(numberPlanForTiers([]).kind).toBe('addon');
    expect(numberPlanForTiers([null, null]).kind).toBe('addon');
    expect(numberPlanForTiers([null], { legacyFlatRate: false }).kind).toBe('addon');
  });
  it('legacy status never overrides a tiered agent: every tier pays', () => {
    expect(numberPlanForTiers(['standard'], { legacyFlatRate: true }).kind).toBe('addon');
    expect(numberPlanForTiers(['pro'], { legacyFlatRate: false }).kind).toBe('addon');
  });
  it('a tenant mixing a tiered and a legacy agent pays the add-on', () => {
    expect(numberPlanForTiers([null, 'standard']).kind).toBe('addon');
  });
});

describe('createdBeforeTiers', () => {
  it('uses the launch day as the cutoff', () => {
    expect(TIERS_LAUNCHED_AT).toBe('2026-10-02T00:00:00.000Z');
    expect(createdBeforeTiers('2026-09-30T10:00:00Z')).toBe(true);
    expect(createdBeforeTiers('2026-10-01T23:59:59Z')).toBe(true);
    expect(createdBeforeTiers('2026-10-02T00:00:00Z')).toBe(false);
    expect(createdBeforeTiers('2026-10-03T00:00:00Z')).toBe(false);
  });
  it('a missing or unparsable date is not legacy (fails toward charging)', () => {
    expect(createdBeforeTiers(undefined)).toBe(false);
    expect(createdBeforeTiers(null)).toBe(false);
    expect(createdBeforeTiers('garbage')).toBe(false);
  });
});

describe('price env vars', () => {
  const saved = { m: process.env.STRIPE_PRICE_NUMBER_TWILIO_MONTHLY, i: process.env.STRIPE_PRICE_NUMBER_TWILIO_INBOUND };
  beforeEach(() => { delete process.env.STRIPE_PRICE_NUMBER_TWILIO_MONTHLY; delete process.env.STRIPE_PRICE_NUMBER_TWILIO_INBOUND; });
  afterEach(() => {
    if (saved.m === undefined) delete process.env.STRIPE_PRICE_NUMBER_TWILIO_MONTHLY; else process.env.STRIPE_PRICE_NUMBER_TWILIO_MONTHLY = saved.m;
    if (saved.i === undefined) delete process.env.STRIPE_PRICE_NUMBER_TWILIO_INBOUND; else process.env.STRIPE_PRICE_NUMBER_TWILIO_INBOUND = saved.i;
  });

  it('missing config throws a clear error naming the variables, never values', () => {
    expect(numberPriceIds('twilio')).toBeNull();
    expect(() => requireNumberPriceIds('twilio')).toThrow(NumberAddOnNotConfiguredError);
    expect(() => requireNumberPriceIds('twilio')).toThrow(/STRIPE_PRICE_NUMBER_TWILIO_MONTHLY, STRIPE_PRICE_NUMBER_TWILIO_INBOUND/);
  });
  it('one of the two missing is still not configured', () => {
    process.env.STRIPE_PRICE_NUMBER_TWILIO_MONTHLY = 'price_m';
    process.env.STRIPE_PRICE_NUMBER_TWILIO_INBOUND = '   ';
    expect(numberPriceIds('twilio')).toBeNull();
    expect(() => requireNumberPriceIds('twilio')).toThrow(/STRIPE_PRICE_NUMBER_TWILIO_INBOUND/);
  });
  it('returns both ids when set', () => {
    process.env.STRIPE_PRICE_NUMBER_TWILIO_MONTHLY = 'price_m';
    process.env.STRIPE_PRICE_NUMBER_TWILIO_INBOUND = 'price_i';
    expect(requireNumberPriceIds('twilio')).toEqual({ monthly: 'price_m', inbound: 'price_i' });
  });
});
