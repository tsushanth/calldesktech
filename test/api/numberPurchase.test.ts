import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeNumberDb, makeFakeStripe } from '../helpers/fakeNumberDb';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/authz', () => ({ authorizeTenant: async () => ({ ok: true }), authorizeResource: async () => ({ ok: true }) }));
vi.mock('@/lib/paymentMethodGate', () => ({ checkPaymentMethodOnFile: async () => ({ ok: true }) }));
vi.mock('@/lib/stripe', () => ({ getStripe: vi.fn() }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { getStripe } from '@/lib/stripe';
import { tenantNumberPlan } from '@/lib/numberAddOnBilling';
import { POST } from '@/app/api/tenants/[id]/phone-numbers/purchase/route';

const MONTHLY = 'price_test_number_monthly';
const INBOUND = 'price_test_number_inbound';
const env = { engine: process.env.CALL_LOOP_POC_BASE_URL, secret: process.env.CALL_LOOP_POC_TEST_CALL_SECRET };

const OLD_TENANT = '2026-08-01T00:00:00.000Z'; // before the tiers launched
const NEW_TENANT = '2026-10-05T00:00:00.000Z'; // after

function seed(tier: string | null, extra: Record<string, unknown[]> = {}, createdAt = NEW_TENANT) {
  return {
    calldesk_tenants: [{ id: 't1', created_at: createdAt, retell_agent_id: null, settings: { voice_engine: 'poc', phone: '+14155550000' } }],
    calldesk_agents: [{ id: 'a1', tenant_id: 't1' }],
    calldesk_agent_versions: tier === undefined ? [] : [{ agent_id: 'a1', version_number: 1, tier }],
    calldesk_businesses: [{ tenant_id: 't1', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1' }],
    calldesk_phone_numbers: [],
    ...extra,
  } as Record<string, Record<string, unknown>[]>;
}

function post(body: Record<string, unknown>) {
  const req = new NextRequest('https://example.com/api/tenants/t1/phone-numbers/purchase', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: 't1' }) });
}

let fetchMock: ReturnType<typeof vi.fn>;
function engineBuys(number = '+14155550123') {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ phone_number: number }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
}
function engineFails() {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'No Twilio numbers available' }), { status: 502 }));
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  process.env.STRIPE_PRICE_NUMBER_TWILIO_MONTHLY = MONTHLY;
  process.env.STRIPE_PRICE_NUMBER_TWILIO_INBOUND = INBOUND;
  process.env.CALL_LOOP_POC_BASE_URL = 'https://engine.test';
  process.env.CALL_LOOP_POC_TEST_CALL_SECRET = 'test-secret';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (env.engine === undefined) delete process.env.CALL_LOOP_POC_BASE_URL; else process.env.CALL_LOOP_POC_BASE_URL = env.engine;
  if (env.secret === undefined) delete process.env.CALL_LOOP_POC_TEST_CALL_SECRET; else process.env.CALL_LOOP_POC_TEST_CALL_SECRET = env.secret;
});

for (const tier of ['lite', 'standard', 'pro']) {
  it(`${tier}: without acceptNumberAddOn the route answers 400 with the terms and buys nothing`, async () => {
    const db = makeNumberDb(seed(tier));
    const { stripe, calls } = makeFakeStripe([]);
    vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
    vi.mocked(getStripe).mockReturnValue(stripe as never);
    engineBuys();
    const res = await post({});
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe('number_addon_acceptance_required');
    expect(body.terms).toMatch(/\$2\.00 per month/);
    expect(body.terms).toMatch(/1\.5 cents per minute/);
    expect(calls).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.tables.calldesk_phone_numbers).toHaveLength(0);
  });

  it(`${tier}: accepted purchase attaches the monthly item (qty 1) and the metered item BEFORE buying, then records a billed number`, async () => {
    const db = makeNumberDb(seed(tier));
    const { stripe, calls } = makeFakeStripe([]);
    const order: string[] = [];
    const origCreate = stripe.subscriptionItems.create;
    stripe.subscriptionItems.create = async (a: { price: string; quantity?: number }) => { order.push(`stripe:${a.price}`); return origCreate(a); };
    vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
    vi.mocked(getStripe).mockReturnValue(stripe as never);
    fetchMock = vi.fn(async () => { order.push('buy'); return new Response(JSON.stringify({ phone_number: '+14155550123' }), { status: 201 }); });
    vi.stubGlobal('fetch', fetchMock);

    const res = await post({ acceptNumberAddOn: true });
    expect(res.status).toBe(201);
    expect(order).toEqual([`stripe:${MONTHLY}`, `stripe:${INBOUND}`, 'buy']);
    expect(calls.find((c) => (c.args[0] as { price: string }).price === MONTHLY)!.args[0]).toMatchObject({ quantity: 1 });
    expect(calls.find((c) => (c.args[0] as { price: string }).price === INBOUND)!.args[0]).not.toHaveProperty('quantity');
    expect(db.tables.calldesk_phone_numbers[0]).toMatchObject({ number: '+14155550123', source: 'purchased', carrier: 'twilio', addon_billed: true });
  });
}

it('a second number raises the monthly quantity to 2 and does not add another metered item', async () => {
  const db = makeNumberDb(seed('standard', { calldesk_phone_numbers: [{ id: 'n1', tenant_id: 't1', number: '+14155550100', source: 'purchased', carrier: 'twilio', addon_billed: true }] }));
  const { stripe, calls } = makeFakeStripe([{ id: 'si_m', price: { id: MONTHLY }, quantity: 1 }, { id: 'si_i', price: { id: INBOUND } }]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  engineBuys('+14155550124');
  const res = await post({ acceptNumberAddOn: true });
  expect(res.status).toBe(201);
  expect(calls.filter((c) => c.op === 'create')).toHaveLength(0);
  expect(calls.find((c) => c.op === 'update')!.args).toEqual(['si_m', { quantity: 2, proration_behavior: 'create_prorations' }]);
});

it('numbers bought before the add-on existed (addon_billed false) are not counted into the quantity', async () => {
  const db = makeNumberDb(seed('standard', { calldesk_phone_numbers: [{ id: 'old', tenant_id: 't1', number: '+14155550001', source: 'purchased', carrier: null, addon_billed: false }] }));
  const { stripe, calls } = makeFakeStripe([]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  engineBuys();
  await post({ acceptNumberAddOn: true });
  expect(calls.find((c) => (c.args[0] as { price: string }).price === MONTHLY)!.args[0]).toMatchObject({ quantity: 1 });
});

it('if the purchase fails the Stripe change is rolled back and nothing is recorded', async () => {
  const db = makeNumberDb(seed('standard'));
  const { stripe, state } = makeFakeStripe([]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  engineFails();
  const res = await post({ acceptNumberAddOn: true });
  expect(res.status).toBe(502);
  expect(state.items).toHaveLength(0); // both items removed again
  expect(db.tables.calldesk_phone_numbers).toHaveLength(0);
});

it('a failed purchase of a second number restores the monthly quantity to 1', async () => {
  const db = makeNumberDb(seed('lite', { calldesk_phone_numbers: [{ id: 'n1', tenant_id: 't1', number: '+14155550100', source: 'purchased', carrier: 'twilio', addon_billed: true }] }));
  const { stripe, state } = makeFakeStripe([{ id: 'si_m', price: { id: MONTHLY }, quantity: 1 }, { id: 'si_i', price: { id: INBOUND } }]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  engineFails();
  await post({ acceptNumberAddOn: true });
  expect(state.items.find((i) => i.id === 'si_m')!.quantity).toBe(1);
  expect(state.items.find((i) => i.id === 'si_i')).toBeTruthy();
});

it('fails closed when the Stripe price env vars are missing: 503, no purchase', async () => {
  delete process.env.STRIPE_PRICE_NUMBER_TWILIO_INBOUND;
  const db = makeNumberDb(seed('standard'));
  const { stripe, calls } = makeFakeStripe([]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  engineBuys();
  const res = await post({ acceptNumberAddOn: true });
  expect(res.status).toBe(503);
  expect((await res.json()).code).toBe('number_addon_not_configured');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(calls).toHaveLength(0);
});

it('fails closed when Stripe errors: 502 retryable, no purchase', async () => {
  const db = makeNumberDb(seed('standard'));
  const { stripe } = makeFakeStripe([], { failCreate: true });
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  engineBuys();
  const res = await post({ acceptNumberAddOn: true });
  const body = await res.json();
  expect(res.status).toBe(502);
  expect(body.retryable).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('no subscription: 402 to start billing, no purchase', async () => {
  const s = seed('standard');
  s.calldesk_businesses = [{ tenant_id: 't1', stripe_subscription_id: null, stripe_customer_id: 'cus_1' }];
  const db = makeNumberDb(s);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(makeFakeStripe([]).stripe as never);
  engineBuys();
  const res = await post({ acceptNumberAddOn: true });
  expect(res.status).toBe(402);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('Pro pays the add-on too: acceptance required, no number bought without it', async () => {
  const db = makeNumberDb(seed('pro'));
  const { stripe, calls } = makeFakeStripe([]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  engineBuys();
  const res = await post({});
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe('number_addon_acceptance_required');
  expect(calls).toHaveLength(0);
  expect(db.tables.calldesk_phone_numbers).toHaveLength(0);
});

it('tenantNumberPlan: a Pro tenant (new or legacy-dated) is on the add-on; only an untiered pre-tiers tenant is included', async () => {
  expect(await tenantNumberPlan(makeNumberDb(seed('pro')) as never, 't1')).toEqual({ kind: 'addon' });
  expect(await tenantNumberPlan(makeNumberDb(seed('pro', {}, OLD_TENANT)) as never, 't1')).toEqual({ kind: 'addon' });
  expect(await tenantNumberPlan(makeNumberDb(seed(null, {}, OLD_TENANT)) as never, 't1')).toEqual({ kind: 'included' });
});

it('genuine legacy tenants (no tier, created before the tiers launched) are unchanged and not blocked', async () => {
  const db = makeNumberDb(seed(null, {}, OLD_TENANT));
  const { stripe, calls } = makeFakeStripe([]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  engineBuys();
  const res = await post({});
  expect(res.status).toBe(201);
  expect(calls).toHaveLength(0);
  expect(db.tables.calldesk_phone_numbers[0]).toMatchObject({ addon_billed: false });
});

it('a NEW tenant with no tiered version is charged the add-on: terms required, items attached, row billed', async () => {
  const db = makeNumberDb(seed(null));
  const { stripe, calls } = makeFakeStripe([]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  engineBuys();
  const refused = await post({});
  expect(refused.status).toBe(400);
  expect((await refused.json()).code).toBe('number_addon_acceptance_required');
  expect(fetchMock).not.toHaveBeenCalled();
  const res = await post({ acceptNumberAddOn: true });
  expect(res.status).toBe(201);
  expect(calls.filter((c) => c.op === 'create')).toHaveLength(2);
  expect(db.tables.calldesk_phone_numbers[0]).toMatchObject({ source: 'purchased', addon_billed: true });
});

it('a new tenant with no agents at all is charged too, and still needs a subscription', async () => {
  const s = seed(null);
  s.calldesk_agents = [];
  s.calldesk_businesses = [{ tenant_id: 't1', stripe_subscription_id: null, stripe_customer_id: 'cus_1' }];
  vi.mocked(getSupabaseAdmin).mockReturnValue(makeNumberDb(s) as never);
  vi.mocked(getStripe).mockReturnValue(makeFakeStripe([]).stripe as never);
  engineBuys();
  const res = await post({ acceptNumberAddOn: true });
  expect(res.status).toBe(402);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('a legacy tenant that mixes in a tiered agent pays', async () => {
  const s = seed('standard', {}, OLD_TENANT);
  vi.mocked(getSupabaseAdmin).mockReturnValue(makeNumberDb(s) as never);
  vi.mocked(getStripe).mockReturnValue(makeFakeStripe([]).stripe as never);
  engineBuys();
  expect((await post({})).status).toBe(400);
});

it('rejects an unknown carrier', async () => {
  const db = makeNumberDb(seed('standard'));
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  const res = await post({ carrier: 'vonage', acceptNumberAddOn: true });
  expect(res.status).toBe(400);
});

const T_MONTHLY = 'price_test_telnyx_monthly';
const T_INBOUND = 'price_test_telnyx_inbound';

it('telnyx: the engine is asked for a telnyx number and the Telnyx prices (not Twilio) are attached', async () => {
  process.env.STRIPE_PRICE_NUMBER_TELNYX_MONTHLY = T_MONTHLY;
  process.env.STRIPE_PRICE_NUMBER_TELNYX_INBOUND = T_INBOUND;
  const db = makeNumberDb(seed('lite'));
  const { stripe, calls } = makeFakeStripe([]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  engineBuys();
  const res = await post({ carrier: 'telnyx', acceptNumberAddOn: true });
  expect(res.status).toBe(201);
  expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toMatchObject({ carrier: 'telnyx' });
  expect(calls.map((c) => (c.args[0] as { price: string }).price).sort()).toEqual([T_INBOUND, T_MONTHLY].sort());
  expect(db.tables.calldesk_phone_numbers[0]).toMatchObject({ carrier: 'telnyx', source: 'purchased', addon_billed: true });
});

it('telnyx: without acceptance the 400 quotes the Telnyx terms', async () => {
  const db = makeNumberDb(seed('standard'));
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  const res = await post({ carrier: 'telnyx' });
  const body = await res.json();
  expect(res.status).toBe(400);
  expect(body).toMatchObject({ code: 'number_addon_acceptance_required', carrier: 'telnyx', monthlyCents: 100, inboundCentsPerMinute: 1 });
  expect(body.terms).toMatch(/\$1\.00 per month/);
});

it('telnyx: not configured fails closed (503) even though Twilio is configured, buying nothing', async () => {
  delete process.env.STRIPE_PRICE_NUMBER_TELNYX_MONTHLY;
  delete process.env.STRIPE_PRICE_NUMBER_TELNYX_INBOUND;
  const db = makeNumberDb(seed('standard'));
  const { stripe, calls } = makeFakeStripe([]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  engineBuys();
  const res = await post({ carrier: 'telnyx', acceptNumberAddOn: true });
  expect(res.status).toBe(503);
  expect(calls).toHaveLength(0);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('a tenant holding a Twilio number buying a Telnyx one starts a separate quantity of 1 (counts are per carrier)', async () => {
  process.env.STRIPE_PRICE_NUMBER_TELNYX_MONTHLY = T_MONTHLY;
  process.env.STRIPE_PRICE_NUMBER_TELNYX_INBOUND = T_INBOUND;
  const db = makeNumberDb(seed('standard', { calldesk_phone_numbers: [{ id: 'n1', tenant_id: 't1', number: '+14155550100', source: 'purchased', carrier: 'twilio', addon_billed: true }] }));
  const { stripe, calls } = makeFakeStripe([{ id: 'si_m', price: { id: MONTHLY }, quantity: 1 }, { id: 'si_i', price: { id: INBOUND } }]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db as never);
  vi.mocked(getStripe).mockReturnValue(stripe as never);
  engineBuys('+14155550125');
  const res = await post({ carrier: 'telnyx', acceptNumberAddOn: true });
  expect(res.status).toBe(201);
  expect(calls.find((c) => (c.args[0] as { price: string }).price === T_MONTHLY)!.args[0]).toMatchObject({ quantity: 1 });
  expect(calls.some((c) => c.op === 'update')).toBe(false); // the Twilio item is untouched
});
