import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { PRICING_TIERS } from '@/lib/pricingTiers';
// @ts-expect-error plain .mjs script without types
import { TIER_PRICES, buildRequests, centsPerSecond } from '../../scripts/stripe-create-tier-prices.mjs';

describe('scripts/stripe-create-tier-prices.mjs', () => {
  it('prices match the tier catalog (2, 6, 10 cents per minute)', () => {
    expect(TIER_PRICES.map((t: { tier: string; cents: number }) => [t.tier, t.cents])).toEqual(PRICING_TIERS.map((t) => [t.id, t.pricePerMinuteCents]));
  });
  it('per-second unit amounts are the per-minute rate / 60', () => {
    expect(centsPerSecond(6)).toBe('0.1');
    expect(centsPerSecond(10)).toBe('0.1666666667');
    expect(centsPerSecond(2)).toBe('0.0333333333');
  });
  it('builds a product, a meter per tier and a metered per-unit monthly price per tier', () => {
    const reqs = buildRequests();
    expect(reqs.map((r: { key: string }) => r.key)).toEqual(['product', 'meter:lite', 'meter:standard', 'meter:pro', 'price:lite', 'price:standard', 'price:pro']);
    const std = reqs.find((r: { key: string }) => r.key === 'price:standard');
    expect(std.body).toMatchObject({ billing_scheme: 'per_unit', 'recurring[usage_type]': 'metered', 'recurring[interval]': 'month', unit_amount_decimal: '0.1', 'recurring[meter]': '{meter:standard.id}' });
  });
  it('is a dry run by default: prints requests, needs no key, sends nothing', () => {
    const out = execFileSync('node', ['scripts/stripe-create-tier-prices.mjs'], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    expect(out).toMatch(/DRY RUN/);
    expect(out).toMatch(/POST https:\/\/api\.stripe\.com\/v1\/prices/);
    expect(out).toMatch(/STRIPE_TIER_STANDARD_PRICE=/);
  });
  it('--live without a key fails before any request', () => {
    expect(() => execFileSync('node', ['scripts/stripe-create-tier-prices.mjs', '--live'], { env: { PATH: process.env.PATH }, encoding: 'utf8', stdio: 'pipe' })).toThrow(/STRIPE_SECRET_KEY/);
  });
});
