import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeNumberDb } from '../helpers/fakeNumberDb';

vi.mock('@/lib/stripe', () => ({ getStripe: vi.fn() }));

import { reportTenantUsageToStripe } from '@/lib/reportUsageToStripe';
import { getTenantNumberInboundUsageSince } from '@/lib/usage';

const NOW = new Date('2026-10-03T12:00:30.000Z');
const SINCE = '2026-10-02T12:00:00.000Z';
const N1 = '+14155550100';

type MeterArgs = { event_name: string; identifier: string; payload: { value: string; stripe_customer_id: string } };
function meterStripe() {
  const create = vi.fn(async (_a: MeterArgs) => ({}));
  return { stripe: { billing: { meterEvents: { create } } } as never, create };
}
const log = (over: Record<string, unknown>): Record<string, unknown> => ({ tenant_id: 't1', created_at: '2026-10-03T01:00:00.000Z', duration_seconds: 120, outcome: 'answered', direction: 'inbound', to_number: N1, is_internal_test: false, tier: 'standard', ...over });
const base = (logs: Array<Record<string, unknown>>, tier: string | null = 'standard'): Record<string, Array<Record<string, unknown>>> => ({
  calldesk_phone_numbers: [{ id: 'n1', tenant_id: 't1', number: N1, source: 'purchased', carrier: 'twilio', addon_billed: true }],
  calldesk_agents: [{ id: 'a1', tenant_id: 't1' }],
  calldesk_agent_versions: [{ agent_id: 'a1', version_number: 1, tier }],
  calldesk_call_logs: logs,
  calldesk_tenants: [{ id: 't1', last_usage_reported_at: SINCE }],
});
const tenant = { id: 't1', last_usage_reported_at: SINCE };
const biz = { tenant_id: 't1', stripe_customer_id: 'cus_1' };

beforeEach(() => {
  process.env.STRIPE_TIER_STANDARD_PRICE = 'price_std';
  process.env.STRIPE_TIER_PRO_PRICE = 'price_pro';
  process.env.STRIPE_TIER_LITE_PRICE = 'price_lite';
  process.env.STRIPE_PRICE_NUMBER_TWILIO_MONTHLY = 'price_m';
  process.env.STRIPE_PRICE_NUMBER_TWILIO_INBOUND = 'price_i';
});
afterEach(() => { vi.restoreAllMocks(); });

it('reports inbound seconds to billed numbers on the number meter, alongside (not instead of) the tier voice meter', async () => {
  const db = makeNumberDb(base([log({ duration_seconds: 120 }), log({ duration_seconds: 30, created_at: '2026-10-03T02:00:00.000Z' })]));
  const { stripe, create } = meterStripe();
  const res = await reportTenantUsageToStripe(db as never, stripe, tenant, biz, NOW);
  expect(res.status).toBe('reported');
  const events = create.mock.calls.map((c) => c[0]);
  const byName = Object.fromEntries(events.map((e) => [e.event_name, e]));
  expect(byName['calldesktech_number_inbound_seconds_twilio'].payload).toEqual({ stripe_customer_id: 'cus_1', value: '150' });
  expect(byName['calldesktech_voice_seconds_standard'].payload.value).toBe('150'); // voice minutes still billed once on the tier meter
  expect(byName['calldesktech_voice_seconds']).toBeUndefined(); // and not on the legacy meter
  for (const e of events) expect(e.identifier.length).toBeLessThanOrEqual(100);
  expect(byName['calldesktech_number_inbound_seconds_twilio'].identifier).toMatch(/^ur:t1:number_inbound_twilio:/);
});

it('does not count internal test calls, outbound calls, calls to other numbers, or calls outside the window', async () => {
  const db = makeNumberDb(base([
    log({ duration_seconds: 60 }),
    log({ duration_seconds: 999, is_internal_test: true }),
    log({ duration_seconds: 999, direction: 'outbound' }),
    log({ duration_seconds: 999, to_number: '+14155550999' }),
    log({ duration_seconds: 999, created_at: '2026-10-01T00:00:00.000Z' }),
  ]));
  const usage = await getTenantNumberInboundUsageSince(db as never, 't1', new Date(SINCE), NOW);
  expect(usage).toEqual([{ carrier: 'twilio', calls: 1, seconds: 60 }]);
});

it('numbers that were not bought under the add-on (addon_billed false or ported) are never reported', async () => {
  const seed = base([log({ duration_seconds: 500 })]);
  seed.calldesk_phone_numbers = [
    { id: 'n1', tenant_id: 't1', number: N1, source: 'purchased', carrier: 'twilio', addon_billed: false },
    { id: 'n2', tenant_id: 't1', number: '+14155550200', source: 'ported', carrier: null, addon_billed: true },
  ];
  const usage = await getTenantNumberInboundUsageSince(makeNumberDb(seed) as never, 't1', new Date(SINCE), NOW);
  expect(usage).toEqual([]);
});

it('Pro tenants pay the add-on like every tier: their billed numbers report inbound seconds', async () => {
  const db = makeNumberDb(base([log({ tier: 'pro', duration_seconds: 300 })], 'pro'));
  const { stripe, create } = meterStripe();
  await reportTenantUsageToStripe(db as never, stripe, tenant, biz, NOW);
  const names = create.mock.calls.map((c) => c[0].event_name);
  expect(names).toContain('calldesktech_voice_seconds_pro');
  expect(names).toContain('calldesktech_number_inbound_seconds_twilio');
});

it('a same-minute retry derives the same identifier (Stripe dedupes it)', async () => {
  const run = async () => {
    const db = makeNumberDb(base([log({})]));
    const { stripe, create } = meterStripe();
    await reportTenantUsageToStripe(db as never, stripe, tenant, biz, NOW);
    return create.mock.calls.map((c) => c[0]).find((e) => e.event_name.includes('number_inbound'))!.identifier;
  };
  expect(await run()).toBe(await run());
});

it('fails loudly (watermark not advanced, nothing sent) when billed numbers had calls but the inbound price is not configured', async () => {
  delete process.env.STRIPE_PRICE_NUMBER_TWILIO_INBOUND;
  const db = makeNumberDb(base([log({})]));
  const { stripe, create } = meterStripe();
  const res = await reportTenantUsageToStripe(db as never, stripe, tenant, biz, NOW);
  expect(res.status).toBe('error');
  expect(JSON.stringify(res)).toMatch(/STRIPE_PRICE_NUMBER_TWILIO_INBOUND is not set/);
  expect(create).not.toHaveBeenCalled();
  expect(db.tables.calldesk_tenants[0].last_usage_reported_at).toBe(SINCE);
});

it('a tenant with no purchased numbers reports exactly what it did before', async () => {
  const seed = base([log({ to_number: null })]);
  seed.calldesk_phone_numbers = [];
  const { stripe, create } = meterStripe();
  await reportTenantUsageToStripe(makeNumberDb(seed) as never, stripe, tenant, biz, NOW);
  expect(create.mock.calls.map((c) => c[0].event_name)).toEqual(['calldesktech_voice_seconds_standard']);
});

it('numbers on both carriers report to their own meters', async () => {
  process.env.STRIPE_PRICE_NUMBER_TELNYX_MONTHLY = 'price_tm';
  process.env.STRIPE_PRICE_NUMBER_TELNYX_INBOUND = 'price_ti';
  const N2 = '+14155550200';
  const seedDb = base([log({ duration_seconds: 120 }), log({ duration_seconds: 60, to_number: N2 })]);
  seedDb.calldesk_phone_numbers.push({ id: 'n2', tenant_id: 't1', number: N2, source: 'purchased', carrier: 'telnyx', addon_billed: true });
  const db = makeNumberDb(seedDb);
  const { stripe, create } = meterStripe();
  const res = await reportTenantUsageToStripe(db as never, stripe, tenant, biz, NOW);
  expect(res.status).toBe('reported');
  const byName = Object.fromEntries(create.mock.calls.map((c) => [c[0].event_name, c[0]]));
  expect(byName['calldesktech_number_inbound_seconds_twilio'].payload.value).toBe('120');
  expect(byName['calldesktech_number_inbound_seconds_telnyx'].payload.value).toBe('60');
  expect(byName['calldesktech_number_inbound_seconds_telnyx'].identifier).toMatch(/:number_inbound_telnyx:/);
});

it('Telnyx inbound calls with the Telnyx inbound price unset fail the tenant loudly', async () => {
  delete process.env.STRIPE_PRICE_NUMBER_TELNYX_INBOUND;
  const seedDb = base([log({ duration_seconds: 60, to_number: '+14155550200' })]);
  seedDb.calldesk_phone_numbers = [{ id: 'n2', tenant_id: 't1', number: '+14155550200', source: 'purchased', carrier: 'telnyx', addon_billed: true }];
  const { stripe, create } = meterStripe();
  const res = await reportTenantUsageToStripe(makeNumberDb(seedDb) as never, stripe, tenant, biz, NOW);
  expect(res.status).toBe('error');
  expect(create).not.toHaveBeenCalled();
});
