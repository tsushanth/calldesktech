import { describe, it, expect, vi, beforeEach } from 'vitest';

const stripeMock = vi.hoisted(() => ({ subscriptions: { retrieve: vi.fn() }, subscriptionItems: { create: vi.fn() } }));
vi.mock('stripe', () => ({ default: class { subscriptions = stripeMock.subscriptions; subscriptionItems = stripeMock.subscriptionItems; } }));

let versionTiers: Array<{ tier: string | null }> = [];
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'not']) b[m] = () => b;
      b.maybeSingle = async () => ({ data: { stripe_subscription_id: 'sub_1' }, error: null });
      b.then = (resolve: (v: unknown) => void) =>
        resolve(table === 'calldesk_agents' ? { data: [{ id: 'a1' }], error: null } : { data: versionTiers, error: null });
      return b;
    },
  }),
}));

import { ensureTierItemsInUseForTenant } from '@/lib/stripe';

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_not_real';
  process.env.STRIPE_TIER_STANDARD_PRICE = 'price_std';
  process.env.STRIPE_TIER_PRO_PRICE = 'price_pro';
  stripeMock.subscriptions.retrieve.mockReset().mockResolvedValue({ id: 'sub_1', status: 'active', items: { data: [] } });
  stripeMock.subscriptionItems.create.mockReset().mockResolvedValue({ id: 'si_new' });
});

describe('ensureTierItemsInUseForTenant (after checkout)', () => {
  it('adds a line per distinct tier already used by the tenant, once each', async () => {
    versionTiers = [{ tier: 'standard' }, { tier: 'standard' }, { tier: 'pro' }];
    const r = await ensureTierItemsInUseForTenant('t1');
    expect(r).toEqual({ ensured: ['standard', 'pro'], failed: [] });
    expect(stripeMock.subscriptionItems.create).toHaveBeenCalledTimes(2);
  });
  it('legacy-only tenants: nothing is added', async () => {
    versionTiers = [];
    expect(await ensureTierItemsInUseForTenant('t1')).toEqual({ ensured: [], failed: [] });
    expect(stripeMock.subscriptionItems.create).not.toHaveBeenCalled();
  });
  it('a Stripe failure is reported, not thrown (the webhook must still succeed)', async () => {
    versionTiers = [{ tier: 'standard' }];
    stripeMock.subscriptionItems.create.mockRejectedValue(new Error('boom'));
    stripeMock.subscriptions.retrieve.mockResolvedValue({ id: 'sub_1', status: 'active', items: { data: [] } });
    expect(await ensureTierItemsInUseForTenant('t1')).toEqual({ ensured: [], failed: ['standard'] });
  });
});
