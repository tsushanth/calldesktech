import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  NUMBER_ADDON_PRICES,
  NUMBER_ADDON_TIERS,
  NUMBER_INBOUND_METER_EVENT,
  NUMBER_PRICE_ENV,
  NumberAddOnNotConfiguredError,
  carrierOfRow,
  numberAddOnTerms,
  numberPlanForTiers,
  numberPriceIds,
  publicNumberAddOn,
  requireNumberPriceIds,
} from '@/lib/numberAddOn';
import { CARRIER_NOTE, PRICING_TIERS } from '@/lib/pricingTiers';
import { compactMinute, meterEventIdentifier } from '@/lib/reportUsageToStripe';

describe('number add-on config', () => {
  it('customer prices: $2.00 per month per number and 1.5 cents per inbound minute on Twilio', () => {
    expect(NUMBER_ADDON_PRICES.twilio.monthlyCents).toBe(200);
    expect(NUMBER_ADDON_PRICES.twilio.inboundCentsPerMinute).toBe(1.5);
    expect(numberAddOnTerms('twilio')).toMatch(/\$2\.00 per month for each number/);
    expect(numberAddOnTerms('twilio')).toMatch(/1\.5 cents per minute of inbound/);
    expect(numberAddOnTerms('twilio')).toMatch(/Outbound calls use your own carrier/);
  });

  it('the shared carrier note quotes the same amounts as the config', () => {
    expect(CARRIER_NOTE).toContain(`$${(NUMBER_ADDON_PRICES.twilio.monthlyCents / 100).toFixed(2)} per month per number`);
    expect(CARRIER_NOTE).toContain(`${NUMBER_ADDON_PRICES.twilio.inboundCentsPerMinute} cents per minute of inbound`);
  });

  it('maps each carrier to its Stripe price env vars and meter event', () => {
    expect(NUMBER_PRICE_ENV.twilio).toEqual({ monthly: 'STRIPE_PRICE_NUMBER_TWILIO_MONTHLY', inbound: 'STRIPE_PRICE_NUMBER_TWILIO_INBOUND' });
    expect(NUMBER_INBOUND_METER_EVENT.twilio).toBe('calldesktech_number_inbound_seconds_twilio');
  });

  it('the add-on tiers are the bring-your-own tiers, never a managed (Pro) tier; Lite is NOT blocked', () => {
    const byo = PRICING_TIERS.filter((t) => t.carrierMode === 'byo').map((t) => t.id);
    expect([...NUMBER_ADDON_TIERS]).toEqual(byo);
    expect(NUMBER_ADDON_TIERS).toContain('lite');
    expect(NUMBER_ADDON_TIERS).toContain('standard');
    expect(NUMBER_ADDON_TIERS).not.toContain('pro');
  });

  it('the public payload carries no cost or margin wording', () => {
    expect(JSON.stringify(publicNumberAddOn())).not.toMatch(/cost|margin|wholesale|markup/i);
  });

  it('a null or empty stored carrier means twilio; an unknown carrier is not billable', () => {
    expect(carrierOfRow(null)).toBe('twilio');
    expect(carrierOfRow('twilio')).toBe('twilio');
    expect(carrierOfRow('telnyx')).toBeNull();
  });

  it('inbound meter identifiers stay within 100 characters', () => {
    const id = meterEventIdentifier('bd6ee88b-bc62-4f65-a54c-3391322502c8', 'number_inbound_twilio', `${compactMinute(null)}_${compactMinute(new Date('2026-10-03T04:36:00Z'))}`);
    expect(id.length).toBeLessThanOrEqual(100);
  });
});

describe('numberPlanForTiers', () => {
  it('Lite and Standard pay the add-on', () => {
    expect(numberPlanForTiers(['lite']).kind).toBe('addon');
    expect(numberPlanForTiers(['standard']).kind).toBe('addon');
    expect(numberPlanForTiers(['lite', 'standard']).kind).toBe('addon');
  });
  it('Pro is included, even next to Lite or Standard agents', () => {
    expect(numberPlanForTiers(['pro']).kind).toBe('included');
    expect(numberPlanForTiers(['standard', 'pro']).kind).toBe('included');
    expect(numberPlanForTiers(['lite', 'pro', null]).kind).toBe('included');
  });
  it('legacy and no-tier tenants are included (never charged, never blocked)', () => {
    expect(numberPlanForTiers([]).kind).toBe('included');
    expect(numberPlanForTiers([null, null]).kind).toBe('included');
    expect(numberPlanForTiers(['bogus']).kind).toBe('included');
  });
  it('a tenant mixing a tiered and a legacy agent pays the add-on', () => {
    expect(numberPlanForTiers([null, 'standard']).kind).toBe('addon');
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
