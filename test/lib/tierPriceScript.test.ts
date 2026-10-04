import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRICING_TIERS } from '@/lib/pricingTiers';
import * as script from '../../scripts/stripe-create-tier-prices.mjs';

// The script is plain .mjs; give the tests a loose view of it.
type Req = { key: string; path: string; idempotencyKey: string; body: Record<string, string>; find?: { path: string; query: { query: string } } };
const { TIER_PRICES, buildRequests, centsPerSecond, findExisting } = script as unknown as {
  TIER_PRICES: Array<{ tier: string; cents: number; env: string }>;
  buildRequests: () => Req[];
  centsPerSecond: (c: number) => string;
  findExisting: (secret: string, req: Req) => Promise<{ id: string } | null>;
};

describe('scripts/stripe-create-tier-prices.mjs', () => {
  it('prices match the tier catalog (2, 5, 9 cents per minute)', () => {
    expect(TIER_PRICES.map((t) => [t.tier, t.cents])).toEqual(PRICING_TIERS.map((t) => [t.id, t.pricePerMinuteCents]));
  });
  it('per-second unit amounts are the per-minute rate / 60', () => {
    expect(centsPerSecond(5)).toBe('0.0833333333');
    expect(centsPerSecond(9)).toBe('0.15');
    expect(centsPerSecond(2)).toBe('0.0333333333');
  });
  it('builds a product, a meter per tier and a metered per-unit monthly price per tier', () => {
    const reqs = buildRequests();
    expect(reqs.map((r) => r.key)).toEqual(['product', 'meter:lite', 'meter:standard', 'meter:pro', 'price:lite', 'price:standard', 'price:pro']);
    const std = reqs.find((r) => r.key === 'price:standard');
    expect(std!.body).toMatchObject({ billing_scheme: 'per_unit', 'recurring[usage_type]': 'metered', 'recurring[interval]': 'month', unit_amount_decimal: '0.0833333333', 'recurring[meter]': '{meter:standard.id}' });
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
  it('is idempotent by metadata and never mutates: every price carries tier, cents_per_minute and unit, is looked up first, and only POSTs creates', () => {
    const reqs = buildRequests();
    for (const t of ['lite', 'standard', 'pro']) {
      const r = reqs.find((x) => x.key === `price:${t}`)!;
      expect(r.body).toMatchObject({ 'metadata[tier]': t, 'metadata[unit]': 'voice_seconds' });
      expect(r.body['metadata[cents_per_minute]']).toBe(String(TIER_PRICES.find((p) => p.tier === t)!.cents));
      expect(r.find!.path).toBe('/prices/search');
      expect(r.find!.query.query).toContain(`metadata['cents_per_minute']:'${r.body['metadata[cents_per_minute]']}'`);
      expect(r.idempotencyKey).toContain(`${r.body['metadata[cents_per_minute]']}c`);
    }
    for (const r of reqs) expect(r.path.startsWith('/')).toBe(true);
    const src = readFileSync(join(process.cwd(), 'scripts/stripe-create-tier-prices.mjs'), 'utf8');
    expect(src).not.toMatch(/method: 'DELETE'|\/prices\/\{|active: 'false'|active=false/);
  });
  it('findExisting reuses a found object (read-only) and returns null when nothing matches', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string) => new Response(JSON.stringify(String(url).includes('/billing/meters') ? { data: [{ id: 'mtr_a', event_name: 'x' }, { id: 'mtr_b', event_name: 'calldesktech_voice_seconds_standard' }] } : { data: [{ id: 'price_old' }] }), { status: 200 })) as never;
    try {
      const reqs = buildRequests();
      expect((await findExisting('sk_test', reqs.find((r) => r.key === 'meter:standard')!))!.id).toBe('mtr_b');
      expect((await findExisting('sk_test', reqs.find((r) => r.key === 'meter:pro')!))).toBeNull();
      expect((await findExisting('sk_test', reqs.find((r) => r.key === 'price:standard')!))!.id).toBe('price_old');
    } finally { globalThis.fetch = real; }
  });
});
