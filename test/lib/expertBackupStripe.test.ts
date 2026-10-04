import { describe, it, expect, vi, beforeEach } from 'vitest';

const stripeMock = vi.hoisted(() => ({ subscriptions: { retrieve: vi.fn() }, subscriptionItems: { create: vi.fn(), del: vi.fn(), update: vi.fn() } }));
vi.mock('stripe', () => ({ default: class { subscriptions = stripeMock.subscriptions; subscriptionItems = stripeMock.subscriptionItems; } }));

let sub: string | null = 'sub_1';
let expertRows: Array<{ routing_mode: string | null }> = [];
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'not']) b[m] = () => b;
      b.maybeSingle = async () => ({ data: sub ? { stripe_subscription_id: sub } : null, error: null });
      b.then = (resolve: (v: unknown) => void) => resolve(table === 'calldesk_agents' ? { data: [{ id: 'a1' }], error: null } : { data: expertRows, error: null });
      return b;
    },
  }),
}));

import { ensureExpertBackupItemForTenant, ensureTierItemsInUseForTenant } from '@/lib/stripe';

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_not_real';
  process.env.STRIPE_PRICE_EXPERT_BACKUP = 'price_eb';
  process.env.STRIPE_TIER_STANDARD_PRICE = 'price_std';
  sub = 'sub_1';
  expertRows = [];
  stripeMock.subscriptions.retrieve.mockReset().mockResolvedValue({ id: 'sub_1', status: 'active', items: { data: [] } });
  stripeMock.subscriptionItems.create.mockReset().mockResolvedValue({ id: 'si_new' });
  stripeMock.subscriptionItems.del.mockReset();
  stripeMock.subscriptionItems.update.mockReset();
});

describe('ensureExpertBackupItemForTenant', () => {
  it('adds the metered item once, with no quantity and no proration', async () => {
    expect(await ensureExpertBackupItemForTenant('t1')).toEqual({ status: 'added', itemId: 'si_new' });
    expect(stripeMock.subscriptionItems.create).toHaveBeenCalledWith({ subscription: 'sub_1', price: 'price_eb', proration_behavior: 'none' });
  });
  it('is idempotent: an existing item is left alone', async () => {
    stripeMock.subscriptions.retrieve.mockResolvedValue({ id: 'sub_1', status: 'active', items: { data: [{ id: 'si_eb', price: { id: 'price_eb' } }] } });
    expect(await ensureExpertBackupItemForTenant('t1')).toEqual({ status: 'already_present', itemId: 'si_eb' });
    expect(stripeMock.subscriptionItems.create).not.toHaveBeenCalled();
  });
  it('fails closed when the price env var is unset: nothing is created', async () => {
    delete process.env.STRIPE_PRICE_EXPERT_BACKUP;
    await expect(ensureExpertBackupItemForTenant('t1')).rejects.toThrow(/not available yet/);
    expect(stripeMock.subscriptionItems.create).not.toHaveBeenCalled();
  });
  it('no subscription (trial) or a cancelled one is a no-op', async () => {
    sub = null;
    expect(await ensureExpertBackupItemForTenant('t1')).toEqual({ status: 'no_subscription' });
    sub = 'sub_1';
    stripeMock.subscriptions.retrieve.mockResolvedValue({ id: 'sub_1', status: 'canceled', items: { data: [] } });
    expect(await ensureExpertBackupItemForTenant('t1')).toEqual({ status: 'no_subscription' });
  });
  it('a concurrent publish that added the item first is accepted', async () => {
    stripeMock.subscriptionItems.create.mockRejectedValue(new Error('race'));
    stripeMock.subscriptions.retrieve
      .mockResolvedValueOnce({ id: 'sub_1', status: 'active', items: { data: [] } })
      .mockResolvedValueOnce({ id: 'sub_1', status: 'active', items: { data: [{ id: 'si_raced', price: { id: 'price_eb' } }] } });
    expect(await ensureExpertBackupItemForTenant('t1')).toEqual({ status: 'already_present', itemId: 'si_raced' });
  });
  it('a real Stripe failure is rethrown', async () => {
    stripeMock.subscriptionItems.create.mockRejectedValue(new Error('boom'));
    await expect(ensureExpertBackupItemForTenant('t1')).rejects.toThrow('boom');
  });
  it('never deletes anything (removal rule)', async () => {
    await ensureExpertBackupItemForTenant('t1');
    expect(stripeMock.subscriptionItems.del).not.toHaveBeenCalled();
  });
});

describe('after checkout backfill', () => {
  it('adds the expert backup line when a version already uses the mode', async () => {
    expertRows = [{ routing_mode: 'expert_backup' }];
    const r = await ensureTierItemsInUseForTenant('t1');
    expect(r.ensured).toContain('expert_backup');
    expect(stripeMock.subscriptionItems.create).toHaveBeenCalledWith(expect.objectContaining({ price: 'price_eb' }));
  });
  it('does nothing for tenants with no expert backup version', async () => {
    expertRows = [{ routing_mode: null }];
    const r = await ensureTierItemsInUseForTenant('t1');
    expect(r.ensured).not.toContain('expert_backup');
    expect(stripeMock.subscriptionItems.create).not.toHaveBeenCalledWith(expect.objectContaining({ price: 'price_eb' }));
  });
  it('a Stripe failure is reported, not thrown', async () => {
    expertRows = [{ routing_mode: 'expert_backup' }];
    stripeMock.subscriptionItems.create.mockRejectedValue(new Error('boom'));
    const r = await ensureTierItemsInUseForTenant('t1');
    expect(r.failed).toContain('expert_backup');
  });
});
