import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeNumberDb, makeFakeStripe } from '../helpers/fakeNumberDb';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/authz', () => ({ authorizeResource: async () => ({ ok: true }) }));
vi.mock('@/lib/stripe', () => ({ getStripe: vi.fn() }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { getStripe } from '@/lib/stripe';
import { DELETE } from '@/app/api/phone-numbers/[id]/route';

const MONTHLY = 'price_test_number_monthly';
const INBOUND = 'price_test_number_inbound';

function del(id: string) {
  return DELETE(new NextRequest(`https://example.com/api/phone-numbers/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) });
}
const row = (id: string, n: string, extra: Record<string, unknown> = {}) => ({ id, tenant_id: 't1', number: n, source: 'purchased', carrier: 'twilio', addon_billed: true, ...extra });
const business = { tenant_id: 't1', stripe_subscription_id: 'sub_1' };

beforeEach(() => {
  process.env.STRIPE_PRICE_NUMBER_TWILIO_MONTHLY = MONTHLY;
  process.env.STRIPE_PRICE_NUMBER_TWILIO_INBOUND = INBOUND;
  process.env.CALL_LOOP_POC_BASE_URL = 'https://engine.test';
  process.env.CALL_LOOP_POC_TEST_CALL_SECRET = 'test-secret';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('releases on the engine, deletes the row and drops the monthly quantity from 2 to 1', async () => {
  const db = makeNumberDb({ calldesk_phone_numbers: [row('n1', '+14155550100'), row('n2', '+14155550101')], calldesk_businesses: [business] });
  const { stripe, calls } = makeFakeStripe([{ id: 'si_m', price: { id: MONTHLY }, quantity: 2 }, { id: 'si_i', price: { id: INBOUND } }]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  const fetchMock = vi.fn(async (_u: string) => new Response(JSON.stringify({ released: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const res = await del('n1');
  expect(res.status).toBe(200);
  expect(String(fetchMock.mock.calls[0][0])).toBe('https://engine.test/release-number');
  expect(db.tables.calldesk_phone_numbers.map((r) => r.id)).toEqual(['n2']);
  expect(calls.find((c) => c.op === 'update')!.args).toEqual(['si_m', { quantity: 1, proration_behavior: 'create_prorations' }]);
  expect(calls.filter((c) => c.op === 'del')).toHaveLength(0);
});

it('releasing the last billed number removes both the monthly and the metered item', async () => {
  const db = makeNumberDb({ calldesk_phone_numbers: [row('n1', '+14155550100')], calldesk_businesses: [business] });
  const { stripe, state } = makeFakeStripe([{ id: 'si_m', price: { id: MONTHLY }, quantity: 1 }, { id: 'si_i', price: { id: INBOUND } }]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  expect((await del('n1')).status).toBe(200);
  expect(state.items).toHaveLength(0);
});

it('while the engine has no release endpoint: 501 and nothing changes (still held, still billed)', async () => {
  const db = makeNumberDb({ calldesk_phone_numbers: [row('n1', '+14155550100')], calldesk_businesses: [business] });
  const { stripe, calls } = makeFakeStripe([{ id: 'si_m', price: { id: MONTHLY }, quantity: 1 }]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
  const res = await del('n1');
  expect(res.status).toBe(501);
  expect((await res.json()).code).toBe('number_release_unavailable');
  expect(db.tables.calldesk_phone_numbers).toHaveLength(1);
  expect(calls).toHaveLength(0);
});

it('an engine failure keeps the number and the billing', async () => {
  const db = makeNumberDb({ calldesk_phone_numbers: [row('n1', '+14155550100')], calldesk_businesses: [business] });
  const { stripe, calls } = makeFakeStripe([]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'twilio down' }), { status: 502 })));
  const res = await del('n1');
  expect(res.status).toBe(502);
  expect(db.tables.calldesk_phone_numbers).toHaveLength(1);
  expect(calls).toHaveLength(0);
});

it('a ported (own) number is only unregistered: no engine call, no Stripe change', async () => {
  const db = makeNumberDb({ calldesk_phone_numbers: [row('p1', '+14155559999', { source: 'ported', addon_billed: false })], calldesk_businesses: [business] });
  const { stripe, calls } = makeFakeStripe([]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  expect((await del('p1')).status).toBe(200);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(calls).toHaveLength(0);
  expect(db.tables.calldesk_phone_numbers).toHaveLength(0);
});

it('an unbilled purchased number (Pro or pre-add-on) is released without touching Stripe', async () => {
  const db = makeNumberDb({ calldesk_phone_numbers: [row('n1', '+14155550100', { addon_billed: false })], calldesk_businesses: [business] });
  const { stripe, calls } = makeFakeStripe([]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  expect((await del('n1')).status).toBe(200);
  expect(calls).toHaveLength(0);
});

it('unknown number: 404', async () => {
  vi.mocked(getSupabaseAdmin).mockReturnValue(makeNumberDb({ calldesk_phone_numbers: [] }) as never);
  expect((await del('nope')).status).toBe(404);
});
