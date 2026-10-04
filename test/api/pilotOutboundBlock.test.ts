import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeFakeDb } from '../helpers/fakePilotDb';

let db = makeFakeDb({});
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => db }));
vi.mock('@/lib/authz', () => ({
  authorizeResource: async () => ({ ok: true, tenantId: 'T' }),
  authorizeTenant: async () => ({ ok: true, tenantId: 'T' }),
}));
vi.mock('@/lib/outreach/adminAuth', () => ({ isCronRequest: () => false }));
vi.mock('@/lib/rateLimiter', () => ({
  tryAcquireToken: async () => true, acquireTokenBlocking: async () => true,
  TWILIO_TENANT: {}, RETELL_TENANT: {}, RETELL_GLOBAL: {}, DEMO_CALL_GLOBAL: {}, DEMO_CALL_IP: {},
}));
const createPhoneCall = vi.fn(async () => ({ call_id: 'rc1' }));
vi.mock('@/lib/retell', () => ({ getRetellClient: () => ({ createPhoneCall }) }));

import { POST as numberCall } from '@/app/api/phone-numbers/[id]/call/route';
import { POST as batchRun } from '@/app/api/batch-calls/[id]/run/route';
import { POST as demoCall } from '@/app/api/demo-call/route';
import { POST as demoLive } from '@/app/api/demo-call/live/route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (url: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

let fetchMock: ReturnType<typeof vi.fn>;
function seed(blocked: boolean, opts = {}) {
  db = makeFakeDb({
    calldesk_tenants: [{ id: 'T', name: 'Acme', retell_agent_id: 'agent_1', pilot_blocked: blocked }],
    calldesk_phone_numbers: [{ id: 'N1', tenant_id: 'T', number: '+14155550100', outbound_agent_version_id: 'V1' }],
    calldesk_agent_versions: [{ id: 'V1', voice_engine: 'poc', retell_agent_id: null }, { id: 'V2', voice_engine: 'retell', retell_agent_id: 'agent_1' }],
    calldesk_batch_calls: [{ id: 'B1', tenant_id: 'T', status: 'pending', agent_version_id: 'V1', scheduled_at: null, call_time_window: null }],
    calldesk_batch_call_targets: [{ id: 'X1', batch_id: 'B1', status: 'pending', phone_number: '+14155550111', created_at: '2026-01-01' }],
  }, opts);
}

beforeEach(() => {
  process.env.CALL_LOOP_POC_BASE_URL = 'https://engine.test';
  process.env.CALL_LOOP_POC_TEST_CALL_SECRET = 'test-secret';
  process.env.RETELL_API_KEY = 'k';
  process.env.RETELL_DEMO_PHONE_NUMBER = '+14155550199';
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ sid: 'CA1' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  createPhoneCall.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); });

async function expectBlocked(res: Response) {
  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body.error).toBe('pilot_blocked');
  expect(body.code).toBe('pilot_blocked');
  expect(typeof body.message).toBe('string');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(createPhoneCall).not.toHaveBeenCalled();
}

describe('blocked pilot tenant: every outbound entry point refuses before any provider/engine request', () => {
  beforeEach(() => seed(true));

  it('POST /api/phone-numbers/[id]/call (also what the MCP place_call tool and API v1 hit)', async () => {
    await expectBlocked(await numberCall(post('/api/phone-numbers/N1/call', { toNumber: '+14155550123' }), ctx('N1')));
  });

  it('POST /api/batch-calls/[id]/run leaves the batch pending and dials nothing', async () => {
    await expectBlocked(await batchRun(post('/api/batch-calls/B1/run'), ctx('B1')));
    expect(db.tables.calldesk_batch_calls[0].status).toBe('pending');
    expect(db.tables.calldesk_batch_call_targets[0].status).toBe('pending');
  });

  it('POST /api/demo-call with a tenant_id', async () => {
    await expectBlocked(await demoCall(post('/api/demo-call', { tenant_id: 'T', phone_number: '+14155550123' })));
  });

  it('POST /api/demo-call/live', async () => {
    await expectBlocked(await demoLive(post('/api/demo-call/live', { tenant_id: 'T', phone_number: '+14155550123' })));
  });
});

describe('unblocked tenant still places calls', () => {
  beforeEach(() => seed(false));

  it('number call reaches the engine', async () => {
    const res = await numberCall(post('/api/phone-numbers/N1/call', { toNumber: '+14155550123' }), ctx('N1'));
    expect(res.status).toBe(201);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://engine.test/place-test-call');
  });

  it('batch run dials its target', async () => {
    const res = await batchRun(post('/api/batch-calls/B1/run'), ctx('B1'));
    expect(res.status).toBe(200);
    expect((await res.json()).placed).toBe(1);
  });

  it('demo-call/live reaches the engine', async () => {
    const res = await demoLive(post('/api/demo-call/live', { tenant_id: 'T', phone_number: '+14155550123' }));
    expect(res.status).toBe(201);
  });
});

it('migration 068 not applied: nobody can be blocked, calls go through', async () => {
  seed(true, { noFlagColumn: true });
  const res = await numberCall(post('/api/phone-numbers/N1/call', { toNumber: '+14155550123' }), ctx('N1'));
  expect(res.status).toBe(201);
});
