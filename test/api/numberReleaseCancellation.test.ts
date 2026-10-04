import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeNumberDb, makeFakeStripe } from '../helpers/fakeNumberDb';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/stripe', () => ({ getStripe: vi.fn(), ensureTierItemsInUseForTenant: vi.fn(async () => {}) }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { getStripe } from '@/lib/stripe';
import { POST as cron } from '@/app/api/cron/release-numbers/route';
import { POST as webhook } from '@/app/api/webhooks/stripe/route';
import { MAX_RELEASES_PER_RUN, RELEASE_GRACE_DAYS, runNumberRelease, scheduleNumberRelease } from '@/lib/numberRelease';

const MONTHLY = 'price_test_number_monthly';
const INBOUND = 'price_test_number_inbound';
const PAST = '2026-10-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';
const num = (id: string, extra: Record<string, unknown> = {}) => ({ id, tenant_id: 't1', number: `+1415555${id.padStart(4, '0')}`, source: 'purchased', carrier: 'twilio', addon_billed: true, release_after: null, ...extra });
const canceled = { tenant_id: 't1', stripe_subscription_id: 'sub_1', subscription_status: 'canceled' };

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret';
  process.env.STRIPE_PRICE_NUMBER_TWILIO_MONTHLY = MONTHLY;
  process.env.STRIPE_PRICE_NUMBER_TWILIO_INBOUND = INBOUND;
  process.env.CALL_LOOP_POC_BASE_URL = 'https://engine.test';
  process.env.CALL_LOOP_POC_TEST_CALL_SECRET = 'test-secret';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function runCron(query = '', auth: string | null = 'Bearer cron-secret') {
  return cron(new NextRequest(`https://example.com/api/cron/release-numbers${query}`, { method: 'POST', headers: auth ? { authorization: auth } : {} }));
}
const engineOk = () => { const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response('{}', { status: 200 })); vi.stubGlobal('fetch', f); return f; };

// ---- cron route ----

it('rejects a missing or wrong bearer', async () => {
  expect((await runCron('', null)).status).toBe(401);
  expect((await runCron('', 'Bearer nope')).status).toBe(401);
});

it('releases a due number: engine call, row deleted, audit row, other tenants and brought numbers untouched', async () => {
  const db = makeNumberDb({
    calldesk_phone_numbers: [num('1', { release_after: PAST }), num('2', { release_after: FUTURE }), num('3', { tenant_id: 't2' }), num('4', { source: 'ported', release_after: PAST })],
    calldesk_businesses: [canceled],
    calldesk_audit_log: [],
  });
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(makeFakeStripe([]).stripe as never);
  const f = engineOk();
  const res = await runCron();
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.outcomes.map((o: { status: string }) => o.status)).toEqual(['released']);
  expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ number: '+14155550001', carrier: 'twilio' });
  expect(db.tables.calldesk_phone_numbers.map((r) => r.id)).toEqual(['2', '3', '4']);
  expect(db.tables.calldesk_audit_log[0]).toMatchObject({ action: 'number.release', tenant_id: 't1' });
});

it('?dry=1 reports and changes nothing (no engine call, no delete)', async () => {
  const db = makeNumberDb({ calldesk_phone_numbers: [num('1', { release_after: PAST })], calldesk_businesses: [canceled] });
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  const f = engineOk();
  const body = await (await runCron('?dry=1')).json();
  expect(body.dry).toBe(true);
  expect(body.outcomes[0].status).toBe('would_release');
  expect(f).not.toHaveBeenCalled();
  expect(db.tables.calldesk_phone_numbers).toHaveLength(1);
});

it('a tenant that resubscribed keeps its number and the date is cleared', async () => {
  const db = makeNumberDb({ calldesk_phone_numbers: [num('1', { release_after: PAST })], calldesk_businesses: [{ ...canceled, subscription_status: 'active' }] });
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  const f = engineOk();
  const body = await (await runCron()).json();
  expect(body.outcomes[0].status).toBe('kept_active_subscription');
  expect(f).not.toHaveBeenCalled();
  expect(db.tables.calldesk_phone_numbers[0].release_after).toBeNull();
});

it('a 404 with an error body from the engine means already released: row removed', async () => {
  const db = makeNumberDb({ calldesk_phone_numbers: [num('1', { release_after: PAST })], calldesk_businesses: [canceled] });
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(makeFakeStripe([]).stripe as never);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'number not found' }), { status: 404 })));
  const body = await (await runCron()).json();
  expect(body.outcomes[0].status).toBe('already_gone');
  expect(db.tables.calldesk_phone_numbers).toHaveLength(0);
});

it('an engine failure or an engine without the route leaves the row for the next run', async () => {
  const db = makeNumberDb({ calldesk_phone_numbers: [num('1', { release_after: PAST }), num('2', { release_after: PAST })], calldesk_businesses: [canceled] });
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'twilio down' }), { status: 502 }))
    .mockResolvedValueOnce(new Response('Not found', { status: 404 })));
  const body = await (await runCron()).json();
  expect(body.outcomes.map((o: { status: string }) => o.status)).toEqual(['engine_failed', 'engine_unsupported']);
  expect(db.tables.calldesk_phone_numbers).toHaveLength(2);
});

it('is idempotent: a second run after success finds nothing to do', async () => {
  const db = makeNumberDb({ calldesk_phone_numbers: [num('1', { release_after: PAST })], calldesk_businesses: [canceled] });
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(makeFakeStripe([]).stripe as never);
  const f = engineOk();
  await runCron();
  const second = await (await runCron()).json();
  expect(second.due).toBe(0);
  expect(f).toHaveBeenCalledTimes(1);
});

it('caps the releases per run', async () => {
  const rows = Array.from({ length: MAX_RELEASES_PER_RUN + 5 }, (_, i) => num(String(i + 1), { release_after: PAST }));
  const db = makeNumberDb({ calldesk_phone_numbers: rows, calldesk_businesses: [canceled] });
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(makeFakeStripe([]).stripe as never);
  const f = engineOk();
  await runCron();
  expect(f).toHaveBeenCalledTimes(MAX_RELEASES_PER_RUN);
  expect(db.tables.calldesk_phone_numbers).toHaveLength(5);
});

it('drops the add-on quantity when the subscription still exists', async () => {
  const db = makeNumberDb({
    calldesk_phone_numbers: [num('1', { release_after: PAST }), num('2')],
    calldesk_businesses: [{ tenant_id: 't1', stripe_subscription_id: 'sub_1', subscription_status: 'unpaid' }],
  });
  const { stripe, calls } = makeFakeStripe([{ id: 'si_m', price: { id: MONTHLY }, quantity: 2 }, { id: 'si_i', price: { id: INBOUND } }]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  engineOk();
  await runCron();
  expect(calls.find((c) => c.op === 'update')!.args).toEqual(['si_m', { quantity: 1, proration_behavior: 'create_prorations' }]);
});

// ---- scheduling helper and webhook ----

it('scheduleNumberRelease sets now + grace on purchased numbers only, and never extends an existing date', async () => {
  const existing = '2026-10-10T00:00:00.000Z';
  const db = makeNumberDb({ calldesk_phone_numbers: [num('1'), num('2', { source: 'ported' }), num('3', { release_after: existing }), num('4', { tenant_id: 't2' })] });
  const now = new Date('2026-10-04T00:00:00.000Z');
  await scheduleNumberRelease(db as never, ['t1'], now);
  const byId = Object.fromEntries(db.tables.calldesk_phone_numbers.map((r) => [r.id, r.release_after]));
  expect(byId['1']).toBe(new Date(now.getTime() + RELEASE_GRACE_DAYS * 86400000).toISOString());
  expect(byId['2']).toBeNull();
  expect(byId['3']).toBe(existing);
  expect(byId['4']).toBeNull();
});

it('webhook: customer.subscription.deleted schedules release for the tenants on that subscription', async () => {
  vi.resetModules();
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  const { POST } = await import('@/app/api/webhooks/stripe/route');
  const { getStripe: gs } = await import('@/lib/stripe');
  const { getSupabaseAdmin: gdb } = await import('@/lib/supabase');
  const db = makeNumberDb({
    calldesk_businesses: [{ tenant_id: 't1', stripe_subscription_id: 'sub_1' }, { tenant_id: 't9', stripe_subscription_id: 'sub_other' }],
    calldesk_users: [{ id: 'u1', stripe_subscription_id: 'sub_1' }],
    calldesk_phone_numbers: [num('1'), num('2', { source: 'ported' }), num('3', { tenant_id: 't9' })],
  });
  vi.mocked(gdb).mockReturnValue(db as never);
  vi.mocked(gs).mockReturnValue({ webhooks: { constructEvent: () => ({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } }) } } as never);
  const res = await POST(new NextRequest('https://example.com/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' }));
  expect(res.status).toBe(200);
  const byId = Object.fromEntries(db.tables.calldesk_phone_numbers.map((r) => [r.id, r.release_after]));
  expect(typeof byId['1']).toBe('string');
  expect(byId['2']).toBeNull();
  expect(byId['3']).toBeNull();
  expect(db.tables.calldesk_businesses[0].subscription_status).toBe('canceled');
});

it('webhook: customer.subscription.updated to active clears the date; past_due does not', async () => {
  vi.resetModules();
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  const { POST } = await import('@/app/api/webhooks/stripe/route');
  const { getStripe: gs } = await import('@/lib/stripe');
  const { getSupabaseAdmin: gdb } = await import('@/lib/supabase');
  const db = makeNumberDb({
    calldesk_businesses: [{ tenant_id: 't1', stripe_subscription_id: 'sub_1' }],
    calldesk_users: [],
    calldesk_phone_numbers: [num('1', { release_after: FUTURE })],
  });
  vi.mocked(gdb).mockReturnValue(db as never);
  const send = (status: string) => {
    vi.mocked(gs).mockReturnValue({ webhooks: { constructEvent: () => ({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status } } }) } } as never);
    return POST(new NextRequest('https://example.com/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' }));
  };
  await send('past_due');
  expect(db.tables.calldesk_phone_numbers[0].release_after).toBe(FUTURE);
  await send('active');
  expect(db.tables.calldesk_phone_numbers[0].release_after).toBeNull();
});

it('webhook: checkout.session.completed (resubscribe) clears the date', async () => {
  vi.resetModules();
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  const { POST } = await import('@/app/api/webhooks/stripe/route');
  const { getStripe: gs } = await import('@/lib/stripe');
  const { getSupabaseAdmin: gdb } = await import('@/lib/supabase');
  const db = makeNumberDb({
    calldesk_businesses: [],
    calldesk_users: [],
    calldesk_tenants: [],
    calldesk_phone_numbers: [num('1', { release_after: FUTURE })],
  });
  vi.mocked(gdb).mockReturnValue(db as never);
  vi.mocked(gs).mockReturnValue({ webhooks: { constructEvent: () => ({ type: 'checkout.session.completed', data: { object: { customer: 'cus_1', subscription: 'sub_2', metadata: { business_id: 't1' } } } }) } } as never);
  const res = await POST(new NextRequest('https://example.com/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' }));
  expect(res.status).toBe(200);
  expect(db.tables.calldesk_phone_numbers[0].release_after).toBeNull();
});
