import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const stripeMock = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn() },
  subscriptionItems: { create: vi.fn() },
}));
vi.mock('stripe', () => ({ default: class { subscriptions = stripeMock.subscriptions; subscriptionItems = stripeMock.subscriptionItems; } }));

let subscriptionId: string | null = 'sub_1';
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b; b.eq = () => b;
      b.maybeSingle = async () => ({ data: subscriptionId ? { stripe_subscription_id: subscriptionId } : null, error: null });
      return b;
    },
  }),
}));

import { tierPriceId, tierBillingConfigured, TierBillingNotConfiguredError, TIER_PRICE_ENV, tierOfPrice, tierRatesFromItems, centsPerMinuteOfPrice } from '@/lib/tierBilling';
import { summarizeCallLogsByTier } from '@/lib/usage';
import { ensureTierItemForTenant } from '@/lib/stripe';

const saved = { ...process.env };
beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_not_real';
  process.env.STRIPE_TIER_STANDARD_PRICE = 'price_std';
  process.env.STRIPE_TIER_PRO_PRICE = 'price_pro';
  delete process.env.STRIPE_TIER_LITE_PRICE;
  subscriptionId = 'sub_1';
  stripeMock.subscriptions.retrieve.mockReset();
  stripeMock.subscriptionItems.create.mockReset();
});
afterEach(() => { process.env = { ...saved }; });

const sub = (priceIds: string[], status = 'active') => ({ id: 'sub_1', status, items: { data: priceIds.map((id, i) => ({ id: `si_${i}`, price: { id } })) } });

describe('tierPriceId / tierBillingConfigured', () => {
  it('reads the documented env vars', () => {
    expect(TIER_PRICE_ENV).toEqual({ lite: 'STRIPE_TIER_LITE_PRICE', standard: 'STRIPE_TIER_STANDARD_PRICE', pro: 'STRIPE_TIER_PRO_PRICE' });
    expect(tierPriceId('standard')).toBe('price_std');
    expect(tierPriceId('pro')).toBe('price_pro');
  });
  it('null when unset, blank or an unknown tier', () => {
    expect(tierPriceId('lite')).toBeNull();
    process.env.STRIPE_TIER_PRO_PRICE = '  ';
    expect(tierPriceId('pro')).toBeNull();
    expect(tierPriceId('storm')).toBeNull();
    expect(tierBillingConfigured('standard')).toBe(true);
    expect(tierBillingConfigured('pro')).toBe(false);
    expect(tierBillingConfigured('lite')).toBe(false);
  });
});

describe('ensureTierItemForTenant', () => {
  it('adds the tier item next to the legacy voice item and leaves the legacy item alone', async () => {
    stripeMock.subscriptions.retrieve.mockResolvedValue(sub(['price_legacy_voice']));
    stripeMock.subscriptionItems.create.mockResolvedValue({ id: 'si_new' });
    expect(await ensureTierItemForTenant('t1', 'standard')).toEqual({ status: 'added', itemId: 'si_new' });
    expect(stripeMock.subscriptionItems.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.subscriptionItems.create).toHaveBeenCalledWith({ subscription: 'sub_1', price: 'price_std', proration_behavior: 'none' });
  });
  it('is idempotent: does nothing when the item is already there', async () => {
    stripeMock.subscriptions.retrieve.mockResolvedValue(sub(['price_legacy_voice', 'price_std']));
    expect(await ensureTierItemForTenant('t1', 'standard')).toEqual({ status: 'already_present', itemId: 'si_1' });
    expect(stripeMock.subscriptionItems.create).not.toHaveBeenCalled();
  });
  it('a different tier on the subscription does not count as present', async () => {
    stripeMock.subscriptions.retrieve.mockResolvedValue(sub(['price_pro']));
    stripeMock.subscriptionItems.create.mockResolvedValue({ id: 'si_new' });
    expect((await ensureTierItemForTenant('t1', 'standard')).status).toBe('added');
  });
  it('no subscription (trial): nothing happens and Stripe is never called', async () => {
    subscriptionId = null;
    expect(await ensureTierItemForTenant('t1', 'standard')).toEqual({ status: 'no_subscription' });
    expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(stripeMock.subscriptionItems.create).not.toHaveBeenCalled();
  });
  it('a canceled subscription is treated as no subscription', async () => {
    stripeMock.subscriptions.retrieve.mockResolvedValue(sub(['price_legacy_voice'], 'canceled'));
    expect(await ensureTierItemForTenant('t1', 'standard')).toEqual({ status: 'no_subscription' });
    expect(stripeMock.subscriptionItems.create).not.toHaveBeenCalled();
  });
  it('unconfigured price: throws before touching the database or Stripe', async () => {
    delete process.env.STRIPE_TIER_STANDARD_PRICE;
    await expect(ensureTierItemForTenant('t1', 'standard')).rejects.toBeInstanceOf(TierBillingNotConfiguredError);
    expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();
  });
  it('Stripe failure on create is rethrown, not swallowed', async () => {
    stripeMock.subscriptions.retrieve.mockResolvedValue(sub(['price_legacy_voice']));
    stripeMock.subscriptionItems.create.mockRejectedValue(new Error('card_declined or whatever'));
    await expect(ensureTierItemForTenant('t1', 'standard')).rejects.toThrow(/whatever/);
  });
  it('Stripe failure on retrieve is rethrown', async () => {
    stripeMock.subscriptions.retrieve.mockRejectedValue(new Error('network'));
    await expect(ensureTierItemForTenant('t1', 'pro')).rejects.toThrow('network');
  });
  it('a failed create that lost a race to a concurrent publish resolves to already_present', async () => {
    stripeMock.subscriptions.retrieve
      .mockResolvedValueOnce(sub(['price_legacy_voice']))
      .mockResolvedValueOnce(sub(['price_legacy_voice', 'price_std']));
    stripeMock.subscriptionItems.create.mockRejectedValue(new Error('duplicate'));
    expect(await ensureTierItemForTenant('t1', 'standard')).toEqual({ status: 'already_present', itemId: 'si_1' });
  });
  it('retry after a failure succeeds (nothing sticky between calls)', async () => {
    stripeMock.subscriptions.retrieve.mockResolvedValue(sub(['price_legacy_voice']));
    stripeMock.subscriptionItems.create.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ id: 'si_new' });
    await expect(ensureTierItemForTenant('t1', 'standard')).rejects.toThrow('boom');
    expect((await ensureTierItemForTenant('t1', 'standard')).status).toBe('added');
  });
});


// Grandfathering: a repricing creates NEW Stripe prices; tenants already on a tier item keep the price they subscribed at.
describe('grandfathering: existing tier items keep their price after a repricing', () => {
  // Standard was 6 cents (0.1 cent per second) before the repricing; the env now points at the new 5 cent price.
  const OLD_STANDARD = { id: 'price_std_old_6c', unit_amount_decimal: '0.1', metadata: { tier: 'standard', cents_per_minute: '6', unit: 'voice_seconds' } };
  const subWith = (items: Array<{ id: string; price: Record<string, unknown> }>) => ({ id: 'sub_1', status: 'active', items: { data: items } });

  it('a tenant on the old Standard price is NOT given a second item and is NOT moved to the new price', async () => {
    stripeMock.subscriptions.retrieve.mockResolvedValue(subWith([{ id: 'si_old', price: OLD_STANDARD }]));
    expect(await ensureTierItemForTenant('t1', 'standard')).toEqual({ status: 'already_present', itemId: 'si_old' });
    expect(stripeMock.subscriptionItems.create).not.toHaveBeenCalled();
  });
  it('a new tenant (no Standard item) gets an item at the CURRENT env price', async () => {
    stripeMock.subscriptions.retrieve.mockResolvedValue(subWith([{ id: 'si_voice', price: { id: 'price_legacy_voice' } }]));
    stripeMock.subscriptionItems.create.mockResolvedValue({ id: 'si_new' });
    expect(await ensureTierItemForTenant('t1', 'standard')).toEqual({ status: 'added', itemId: 'si_new' });
    expect(stripeMock.subscriptionItems.create).toHaveBeenCalledWith({ subscription: 'sub_1', price: 'price_std', proration_behavior: 'none' });
  });
  it('an old price of another tier does not satisfy this tier', async () => {
    stripeMock.subscriptions.retrieve.mockResolvedValue(subWith([{ id: 'si_pro_old', price: { id: 'price_pro_old', metadata: { tier: 'pro', unit: 'voice_seconds' } } }]));
    stripeMock.subscriptionItems.create.mockResolvedValue({ id: 'si_new' });
    expect((await ensureTierItemForTenant('t1', 'standard')).status).toBe('added');
  });
  it('a price without the tier metadata that is not the env price is not recognised (create tier prices with the script)', () => {
    expect(tierOfPrice({ id: 'price_hand_made' })).toBeNull();
    expect(tierOfPrice({ id: 'x', metadata: { tier: 'standard', unit: 'something_else' } })).toBeNull();
    expect(tierOfPrice({ id: 'price_std' })).toBe('standard');
    expect(tierOfPrice(OLD_STANDARD)).toBe('standard');
  });
  it('reads cents per minute from the tenant item, not the catalog', () => {
    expect(centsPerMinuteOfPrice(OLD_STANDARD)).toBe(6);
    expect(centsPerMinuteOfPrice({ id: 'p', unit_amount_decimal: '0.15' })).toBe(9);
    expect(centsPerMinuteOfPrice({ id: 'p', unit_amount_decimal: '6', transform_quantity: { divide_by: 60 } })).toBe(6);
    expect(centsPerMinuteOfPrice({ id: 'p' })).toBeNull();
    expect(tierRatesFromItems([{ price: OLD_STANDARD }, { price: { id: 'price_legacy_voice', unit_amount_decimal: '0.2' } }])).toEqual({ standard: 6 });
  });
  it('the billing display charges a grandfathered tenant at its own 6 cents and a new one at the catalog 5 cents', () => {
    const logs = [{ duration_seconds: 600, outcome: null, tier: 'standard' }];
    expect(summarizeCallLogsByTier(logs, null, tierRatesFromItems([{ price: OLD_STANDARD }]))[0]).toMatchObject({ centsPerMinute: 6, chargeCents: 60 });
    expect(summarizeCallLogsByTier(logs, null, {})[0]).toMatchObject({ centsPerMinute: 5, chargeCents: 50 });
  });
});
