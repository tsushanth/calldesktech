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

import { tierPriceId, tierBillingConfigured, TierBillingNotConfiguredError, TIER_PRICE_ENV } from '@/lib/tierBilling';
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
