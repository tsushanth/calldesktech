import { it, expect, vi, beforeEach } from 'vitest';
import { makeNumberDb } from '../helpers/fakeNumberDb';

vi.mock('@/lib/stripe', () => ({ getStripe: vi.fn() }));

import { reportTenantUsageToStripe } from '@/lib/reportUsageToStripe';
import { getTenantExpertBackupUsageSince } from '@/lib/usage';

const NOW = new Date('2026-10-03T12:00:30.000Z');
const SINCE = '2026-10-02T12:00:00.000Z';

type MeterArgs = { event_name: string; identifier: string; payload: { value: string; stripe_customer_id: string } };
function meterStripe() {
  const create = vi.fn(async (_a: MeterArgs) => ({}));
  return { stripe: { billing: { meterEvents: { create } } } as never, create };
}
const log = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ tenant_id: 't1', created_at: '2026-10-03T01:00:00.000Z', duration_seconds: 120, outcome: 'answered', is_internal_test: false, tier: 'standard', routing_mode: 'expert_backup', ...over });
const seed = (logs: Array<Record<string, unknown>>) => ({ calldesk_call_logs: logs, calldesk_tenants: [{ id: 't1', last_usage_reported_at: SINCE }] });
const tenant = { id: 't1', last_usage_reported_at: SINCE };
const biz = { tenant_id: 't1', stripe_customer_id: 'cus_1' };

beforeEach(() => {
  process.env.STRIPE_TIER_STANDARD_PRICE = 'price_std';
  process.env.STRIPE_TIER_LITE_PRICE = 'price_lite';
  process.env.STRIPE_TIER_PRO_PRICE = 'price_pro';
  process.env.STRIPE_PRICE_EXPERT_BACKUP = 'price_eb';
});

it('reports whole seconds of expert backup calls on its own meter, next to (not instead of) the tier voice meter', async () => {
  const db = makeNumberDb(seed([log({ duration_seconds: 120 }), log({ duration_seconds: 45, created_at: '2026-10-03T02:00:00.000Z' }), log({ routing_mode: null, duration_seconds: 600 })]));
  const { stripe, create } = meterStripe();
  const res = await reportTenantUsageToStripe(db as never, stripe, tenant, biz, NOW);
  expect(res.status).toBe('reported');
  const events = create.mock.calls.map((c) => c[0]);
  const byName = Object.fromEntries(events.map((e) => [e.event_name, e]));
  expect(byName['calldesktech_expert_backup_seconds'].payload).toEqual({ stripe_customer_id: 'cus_1', value: '165' }); // 120 + 45
  expect(byName['calldesktech_voice_seconds_standard'].payload.value).toBe('765'); // all three calls' voice time still on the tier meter (120 + 45 + 600)
  expect(byName['calldesktech_expert_backup_seconds'].identifier).toMatch(/^ur:t1:expert_backup:/);
  for (const e of events) expect(e.identifier.length).toBeLessThanOrEqual(100);
  expect(events.filter((e) => e.event_name === 'calldesktech_expert_backup_seconds')).toHaveLength(1);
});

it('floors each call to whole seconds and ignores empty durations', async () => {
  const db = makeNumberDb(seed([log({ duration_seconds: 59.9 }), log({ duration_seconds: 0 }), log({ duration_seconds: null })]));
  expect(await getTenantExpertBackupUsageSince(db as never, 't1', new Date(SINCE), NOW)).toEqual({ calls: 1, seconds: 59 });
});

it('excludes internal test calls, other windows and calls without the mode', async () => {
  const db = makeNumberDb(seed([
    log({ duration_seconds: 60 }),
    log({ duration_seconds: 999, is_internal_test: true }),
    log({ duration_seconds: 999, created_at: '2026-10-01T00:00:00.000Z' }),
    log({ duration_seconds: 999, routing_mode: null }),
    log({ duration_seconds: 999, routing_mode: 'something_else' }),
  ]));
  expect(await getTenantExpertBackupUsageSince(db as never, 't1', new Date(SINCE), NOW)).toEqual({ calls: 1, seconds: 60 });
});

it('a tenant with no expert backup calls reports exactly what it did before', async () => {
  const { stripe, create } = meterStripe();
  await reportTenantUsageToStripe(makeNumberDb(seed([log({ routing_mode: null })])) as never, stripe, tenant, biz, NOW);
  expect(create.mock.calls.map((c) => c[0].event_name)).toEqual(['calldesktech_voice_seconds_standard']);
});

it('a same-minute retry derives the same identifier (Stripe dedupes it)', async () => {
  const run = async () => {
    const { stripe, create } = meterStripe();
    await reportTenantUsageToStripe(makeNumberDb(seed([log()])) as never, stripe, tenant, biz, NOW);
    return create.mock.calls.map((c) => c[0]).find((e) => e.event_name === 'calldesktech_expert_backup_seconds')!.identifier;
  };
  expect(await run()).toBe(await run());
});

it('fails loudly (watermark kept, nothing sent) when expert backup calls exist and the price env var is unset', async () => {
  delete process.env.STRIPE_PRICE_EXPERT_BACKUP;
  const db = makeNumberDb(seed([log()]));
  const { stripe, create } = meterStripe();
  const res = await reportTenantUsageToStripe(db as never, stripe, tenant, biz, NOW);
  expect(res.status).toBe('error');
  expect(JSON.stringify(res)).toMatch(/STRIPE_PRICE_EXPERT_BACKUP is not set/);
  expect(create).not.toHaveBeenCalled();
  expect(db.tables.calldesk_tenants[0].last_usage_reported_at).toBe(SINCE);
});

it('an unset env var does not matter when no expert backup calls happened', async () => {
  delete process.env.STRIPE_PRICE_EXPERT_BACKUP;
  const { stripe } = meterStripe();
  const res = await reportTenantUsageToStripe(makeNumberDb(seed([log({ routing_mode: null })])) as never, stripe, tenant, biz, NOW);
  expect(res.status).toBe('reported');
});

it('a database without the routing_mode column (migration 071 not applied) reports zero instead of failing', async () => {
  const failing = { from: () => { const b: Record<string, unknown> = {}; for (const m of ['select', 'eq', 'neq', 'lt', 'gte']) b[m] = () => b; b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: '42703', message: 'column calldesk_call_logs.routing_mode does not exist' } }).then(res); return b; } };
  expect(await getTenantExpertBackupUsageSince(failing as never, 't1', new Date(SINCE), NOW)).toEqual({ calls: 0, seconds: 0 });
});
