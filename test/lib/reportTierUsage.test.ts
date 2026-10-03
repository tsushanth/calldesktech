import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reportTenantUsageToStripe, TIER_METER_EVENT_NAMES } from '@/lib/reportUsageToStripe';

type Log = { created_at: string; duration_seconds: number; outcome: string | null; tier?: string | null };
let logs: Log[] = [];
const updates: string[] = [];

const supabase = {
  from(table: string) {
    const b: Record<string, unknown> = {};
    b.select = () => b; b.eq = () => b; b.lt = () => b; b.gte = () => b;
    b.update = (patch: { last_usage_reported_at: string }) => ({ eq: () => { updates.push(patch.last_usage_reported_at); return Promise.resolve({ error: null }); } });
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: table === 'calldesk_call_logs' ? logs : [], error: null }).then(res);
    return b;
  },
} as never;

type Ev = { event_name: string; identifier: string; timestamp: number; payload: { stripe_customer_id: string; value: string } };
const create = vi.fn(async (_e: Ev) => ({}));
const stripe = { billing: { meterEvents: { create } } } as never;

const tenant = { id: 't1', last_usage_reported_at: '2026-01-01T00:00:00.000Z' };
const business = { tenant_id: 't1', stripe_customer_id: 'cus_1' };
const NOW = new Date('2026-01-02T12:00:30.000Z');
const at = '2026-01-02T00:00:00.000Z';
const events = () => create.mock.calls.map(([e]) => e);

beforeEach(() => {
  logs = []; updates.length = 0; create.mockClear();
  process.env.STRIPE_TIER_STANDARD_PRICE = 'price_std';
  process.env.STRIPE_TIER_PRO_PRICE = 'price_pro';
  delete process.env.STRIPE_TIER_LITE_PRICE;
});

describe('tier usage reporting in the daily cron', () => {
  it('mixed legacy and tiered calls: each call counted once, on its own meter, tiered events not reported', async () => {
    logs = [
      { created_at: at, duration_seconds: 600, outcome: 'booked' }, // legacy
      { created_at: at, duration_seconds: 60, outcome: 'transferred', tier: null },
      { created_at: at, duration_seconds: 1200, outcome: 'booked', tier: 'standard' },
      { created_at: at, duration_seconds: 300, outcome: 'voicemail', tier: 'standard' },
      { created_at: at, duration_seconds: 90, outcome: 'transferred', tier: 'pro' },
    ];
    const r = await reportTenantUsageToStripe(supabase, stripe, tenant, business, NOW);
    expect(r.status).toBe('reported');
    const byName = Object.fromEntries(events().map((e) => [e.event_name, e.payload.value]));
    expect(byName).toEqual({
      calldesktech_voice_seconds: '660', // legacy only
      calldesktech_booking_events: '1', // legacy booking only, not the standard one
      calldesktech_transfer_events: '1', // legacy transfer only, not the pro one
      calldesktech_voice_seconds_standard: '1500',
      calldesktech_voice_seconds_pro: '90',
    });
    expect(events().every((e) => e.payload.stripe_customer_id === 'cus_1')).toBe(true);
    // total seconds reported across voice meters equals total call seconds: nothing dropped, nothing doubled
    const voiceTotal = events().filter((e) => e.event_name.startsWith('calldesktech_voice_seconds')).reduce((s, e) => s + Number(e.payload.value), 0);
    expect(voiceTotal).toBe(600 + 60 + 1200 + 300 + 90);
    expect(events().find((e) => e.event_name === TIER_METER_EVENT_NAMES.standard)!.identifier).toMatch(/^usage-report:t1:voice_standard:/);
    expect(updates).toHaveLength(1);
  });

  it('a re-run in the same minute derives identical identifiers (Stripe dedupes them)', async () => {
    logs = [
      { created_at: at, duration_seconds: 100, outcome: null },
      { created_at: at, duration_seconds: 200, outcome: null, tier: 'standard' },
    ];
    await reportTenantUsageToStripe(supabase, stripe, tenant, business, new Date('2026-01-02T12:00:05.000Z'));
    const first = events().map((e) => [e.event_name, e.identifier, e.timestamp]);
    create.mockClear();
    await reportTenantUsageToStripe(supabase, stripe, tenant, business, new Date('2026-01-02T12:00:55.000Z'));
    expect(events().map((e) => [e.event_name, e.identifier, e.timestamp])).toEqual(first);
  });

  it('no tiered call appears in any legacy event, and an only-tiered window reports no legacy events', async () => {
    logs = [{ created_at: at, duration_seconds: 500, outcome: 'booked', tier: 'pro' }];
    await reportTenantUsageToStripe(supabase, stripe, tenant, business, NOW);
    expect(events().map((e) => e.event_name)).toEqual(['calldesktech_voice_seconds_pro']);
  });

  it('an unknown tier id counts as legacy', async () => {
    logs = [{ created_at: at, duration_seconds: 120, outcome: 'booked', tier: 'platinum' }];
    await reportTenantUsageToStripe(supabase, stripe, tenant, business, NOW);
    expect(events().map((e) => [e.event_name, e.payload.value])).toEqual([['calldesktech_voice_seconds', '120'], ['calldesktech_booking_events', '1']]);
  });

  it('a tier with calls but no configured price fails the tenant loudly: nothing reported, watermark not advanced', async () => {
    delete process.env.STRIPE_TIER_STANDARD_PRICE;
    logs = [
      { created_at: at, duration_seconds: 100, outcome: null },
      { created_at: at, duration_seconds: 200, outcome: null, tier: 'standard' },
    ];
    const r = await reportTenantUsageToStripe(supabase, stripe, tenant, business, NOW);
    expect(r.status).toBe('error');
    expect((r as { error: string }).error).toMatch(/STRIPE_TIER_STANDARD_PRICE/);
    expect(create).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('an unconfigured tier with no calls in the window does not matter', async () => {
    logs = [{ created_at: at, duration_seconds: 100, outcome: null }];
    expect((await reportTenantUsageToStripe(supabase, stripe, tenant, business, NOW)).status).toBe('reported');
  });

  it('a Stripe failure on a tier event leaves the watermark where it was', async () => {
    logs = [{ created_at: at, duration_seconds: 200, outcome: null, tier: 'standard' }];
    create.mockRejectedValueOnce(new Error('stripe down'));
    const r = await reportTenantUsageToStripe(supabase, stripe, tenant, business, NOW);
    expect(r.status).toBe('error');
    expect(updates).toHaveLength(0);
  });

  it('a legacy-only tenant is byte-identical to before: same events, names, values, identifiers, no tier meters', async () => {
    logs = [{ created_at: at, duration_seconds: 600, outcome: 'booked' }, { created_at: at, duration_seconds: 60, outcome: 'voicemail' }];
    const r = await reportTenantUsageToStripe(supabase, stripe, tenant, business, NOW);
    const period = `2026-01-01T00:00:00.000Z_2026-01-02T12:00:00.000Z`;
    const ts = Math.floor(new Date('2026-01-02T12:00:00.000Z').getTime() / 1000);
    expect(events()).toEqual([
      { event_name: 'calldesktech_voice_seconds', identifier: `usage-report:t1:voice:${period}`, timestamp: ts, payload: { stripe_customer_id: 'cus_1', value: '660' } },
      { event_name: 'calldesktech_booking_events', identifier: `usage-report:t1:booking:${period}`, timestamp: ts, payload: { stripe_customer_id: 'cus_1', value: '1' } },
      { event_name: 'calldesktech_message_events', identifier: `usage-report:t1:message:${period}`, timestamp: ts, payload: { stripe_customer_id: 'cus_1', value: '1' } },
    ]);
    expect(r.status).toBe('reported');
  });
});
