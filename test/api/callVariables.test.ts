import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeFakeDb } from '../helpers/fakePilotDb';

let db = makeFakeDb({});
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => db }));
vi.mock('@/lib/authz', () => ({ authorizeResource: async () => ({ ok: true, tenantId: 'T' }) }));
vi.mock('@/lib/rateLimiter', () => ({ tryAcquireToken: async () => true, TWILIO_TENANT: {} }));
const createPhoneCall = vi.fn(async (...args: unknown[]) => (void args, { call_id: 'rc1' }));
vi.mock('@/lib/retell', () => ({ getRetellClient: () => ({ createPhoneCall }) }));

import { POST } from '@/app/api/phone-numbers/[id]/call/route';
import { parseCallVariables } from '@/lib/callVariables';

const ctx = { params: Promise.resolve({ id: 'N1' }) };
const post = (body: unknown, raw = false) =>
  new NextRequest('http://localhost/api/phone-numbers/N1/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ? (body as string) : JSON.stringify(body) });

let fetchMock: ReturnType<typeof vi.fn>;
function seed(engine: 'poc' | 'retell') {
  db = makeFakeDb({
    calldesk_tenants: [{ id: 'T', name: 'Acme', pilot_blocked: false }],
    calldesk_phone_numbers: [{ id: 'N1', tenant_id: 'T', number: '+14155550100', outbound_agent_version_id: 'V1' }],
    calldesk_agent_versions: [{ id: 'V1', voice_engine: engine, retell_agent_id: engine === 'retell' ? 'agent_1' : null }],
  });
}
const engineBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);

beforeEach(() => {
  process.env.CALL_LOOP_POC_BASE_URL = 'https://engine.test';
  process.env.CALL_LOOP_POC_TEST_CALL_SECRET = 's';
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ sid: 'CA1' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  createPhoneCall.mockClear();
  seed('poc');
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /phone-numbers/[id]/call variables', () => {
  it('backward compatible: toNumber only sends no variables key', async () => {
    const res = await POST(post({ toNumber: '+14155550123' }), ctx);
    expect(res.status).toBe(201);
    expect(engineBody()).toEqual({ toNumber: '+14155550123', routeAs: '+14155550100', direction: 'outbound' });
  });

  it('passes variables to the poc engine exactly like the batch path', async () => {
    const res = await POST(post({ toNumber: '+14155550123', variables: { first_name: 'Dana', reason: 'reminder', empty: '  ' } }), ctx);
    expect(res.status).toBe(201);
    expect(engineBody().variables).toEqual({ first_name: 'Dana', reason: 'reminder' });
  });

  it('passes variables to Retell as dynamicVariables', async () => {
    seed('retell');
    const res = await POST(post({ toNumber: '+14155550123', variables: { first_name: 'Dana' } }), ctx);
    expect(res.status).toBe(201);
    expect(createPhoneCall).toHaveBeenCalledWith(expect.objectContaining({ dynamicVariables: { first_name: 'Dana' } }));
  });

  it('Retell without variables passes undefined', async () => {
    seed('retell');
    await POST(post({ toNumber: '+14155550123' }), ctx);
    expect(createPhoneCall.mock.calls[0][0]).toMatchObject({ dynamicVariables: undefined });
  });

  it.each([
    ['array', ['a']],
    ['string', 'x'],
    ['non-string value', { a: 1 }],
    ['bad key', { 'first name': 'x' }],
    ['long value', { a: 'x'.repeat(501) }],
    ['too many keys', Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`k${i}`, 'v']))],
  ])('400 on invalid variables: %s, and nothing is dialed', async (_n, variables) => {
    const res = await POST(post({ toNumber: '+14155550123', variables }), ctx);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400 on malformed JSON and on missing toNumber', async () => {
    expect((await POST(post('{nope', true), ctx)).status).toBe(400);
    expect((await POST(post({ variables: { a: 'b' } }), ctx)).status).toBe(400);
  });
});

describe('parseCallVariables', () => {
  it('rejects total size over 4000 bytes', () => {
    const v = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, 'x'.repeat(450)]));
    expect(parseCallVariables(v).ok).toBe(false);
  });
  it('null/undefined/empty object mean none', () => {
    for (const x of [undefined, null, {}]) expect(parseCallVariables(x)).toEqual({ ok: true, variables: undefined });
  });
});
