import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeFakeDb } from '../helpers/fakeDb';

const CRON = 'test-cron-secret';
let admin: { email: string } | null = null;
let db = makeFakeDb({});

vi.mock('@/lib/outreach/adminAuth', () => ({
  isCronRequest: (req: Request) => req.headers.get('authorization') === `Bearer ${CRON}`,
  requireAdminSession: vi.fn(async () => admin),
}));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => db }));
const sendEmail = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => (sendEmail as (...x: unknown[]) => unknown)(...a) }));

import { POST as watchPOST } from '@/app/api/cron/pilot-watch/route';
import { POST as weeklyPOST } from '@/app/api/cron/pilot-weekly-report/route';
import { GET as listGET, POST as createPOST } from '@/app/api/admin/pilots/route';
import { GET as oneGET, PATCH as onePATCH } from '@/app/api/admin/pilots/[id]/route';

const TENANT = '11111111-1111-4111-8111-111111111111';
const PILOT = '22222222-2222-4222-8222-222222222222';
const req = (url: string, init: RequestInit & { auth?: string } = {}) =>
  new NextRequest(`http://localhost${url}`, { ...init, headers: { 'content-type': 'application/json', ...(init.auth ? { authorization: init.auth } : {}) } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function fresh() {
  const old = new Date(Date.now() - 30 * 3600_000).toISOString();
  db = makeFakeDb({
    calldesk_tenants: [{ id: TENANT, name: 'Acme', user_id: 'u1', pilot_blocked: false }],
    calldesk_users: [{ id: 'u1', email: 'dana@acme.test' }],
    calldesk_pilots: [{ id: PILOT, tenant_id: TENANT, company: 'Acme', contact_email: 'c@acme.test', started_at: old, ends_at: new Date(Date.now() + 6 * 86400_000).toISOString(), minutes_cap: 50, status: 'active', notes: null, created_at: old }],
    calldesk_pilot_events: [],
    calldesk_call_logs: [],
  });
}

beforeEach(() => {
  admin = null;
  sendEmail.mockClear();
  process.env.CRON_SECRET = CRON;
  delete process.env.PILOT_ALERT_EMAIL;
  delete process.env.RESEND_API_KEY;
  fresh();
});

describe('cron endpoints', () => {
  for (const [name, handler] of [['pilot-watch', watchPOST], ['pilot-weekly-report', weeklyPOST]] as const) {
    it(`${name} rejects missing and wrong secrets and admin sessions`, async () => {
      admin = { email: 'a@b.c' };
      expect((await handler(req(`/api/cron/${name}`, { method: 'POST' }))).status).toBe(401);
      expect((await handler(req(`/api/cron/${name}`, { method: 'POST', auth: 'Bearer nope' }))).status).toBe(401);
      expect(sendEmail).not.toHaveBeenCalled();
    });
  }

  it('pilot-watch ?dry=1 returns the plan and sends nothing', async () => {
    const res = await watchPOST(req('/api/cron/pilot-watch?dry=1', { method: 'POST', auth: `Bearer ${CRON}` }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.dry).toBe(true);
    expect(j.emails[0]).toMatchObject({ kinds: ['no_calls_24h'], result: 'would_send' });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it('pilot-watch without env sends nothing even when authorized', async () => {
    const res = await watchPOST(req('/api/cron/pilot-watch', { method: 'POST', auth: `Bearer ${CRON}` }));
    const j = await res.json();
    expect(j.skipped).toMatch(/not set/);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.tables.calldesk_pilot_events).toEqual([]);
  });

  it('pilot-watch with env sends once to the owner', async () => {
    process.env.PILOT_ALERT_EMAIL = 'owner@example.com';
    process.env.RESEND_API_KEY = 'x';
    await watchPOST(req('/api/cron/pilot-watch', { method: 'POST', auth: `Bearer ${CRON}` }));
    await watchPOST(req('/api/cron/pilot-watch', { method: 'POST', auth: `Bearer ${CRON}` }));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((sendEmail.mock.calls[0] as unknown as [{ to: string }])[0].to).toBe('owner@example.com');
  });

  it('weekly dry run returns the digest', async () => {
    const res = await weeklyPOST(req('/api/cron/pilot-weekly-report?dry=1', { method: 'POST', auth: `Bearer ${CRON}` }));
    const j = await res.json();
    expect(j.result).toBe('would_send');
    expect(j.text).toContain('Acme');
  });
});

describe('admin API auth', () => {
  it('rejects everything without an admin session, including a cron secret', async () => {
    const auth = `Bearer ${CRON}`;
    expect((await listGET()).status).toBe(401);
    expect((await createPOST(req('/api/admin/pilots', { method: 'POST', auth, body: JSON.stringify({ tenant_id: TENANT }) }))).status).toBe(401);
    expect((await oneGET(req(`/api/admin/pilots/${PILOT}`, { auth }), ctx(PILOT))).status).toBe(401);
    expect((await onePATCH(req(`/api/admin/pilots/${PILOT}`, { method: 'PATCH', auth, body: JSON.stringify({ action: 'stop' }) }), ctx(PILOT))).status).toBe(401);
    expect(db.writes).toEqual([]);
  });

  it('lists pilots with stats for an admin', async () => {
    admin = { email: 'a@b.c' };
    const j = await (await listGET()).json();
    expect(j.pilots[0].stats.calls).toBe(0);
    expect(j.pilots[0].stats.nextAction.code).toBe('check_forwarding');
  });
});

describe('admin pilot actions', () => {
  beforeEach(() => { admin = { email: 'a@b.c' }; });
  const create = (body: unknown) => createPOST(req('/api/admin/pilots', { method: 'POST', body: JSON.stringify(body) }));
  const patch = (body: unknown) => onePATCH(req(`/api/admin/pilots/${PILOT}`, { method: 'PATCH', body: JSON.stringify(body) }), ctx(PILOT));

  it('creates a 7 day, 50 minute pilot by default, by owner email, and rejects duplicates', async () => {
    db.tables.calldesk_pilots = [];
    const res = await create({ owner_email: 'Dana@acme.test', company: 'Acme' });
    expect(res.status).toBe(201);
    const { pilot } = await res.json();
    expect(pilot.tenant_id).toBe(TENANT);
    expect(Number(pilot.minutes_cap)).toBe(50);
    expect(Date.parse(pilot.ends_at) - Date.parse(pilot.started_at)).toBe(7 * 86400_000);
    expect((await create({ tenant_id: TENANT })).status).toBe(409);
  });

  it('validates input', async () => {
    expect((await create({})).status).toBe(400);
    expect((await create({ tenant_id: 'nope' })).status).toBe(400);
    expect((await create({ tenant_id: TENANT, contact_email: 'bad' })).status).toBe(400);
    expect((await create({ tenant_id: TENANT, minutes_cap: -1 })).status).toBe(400);
    expect((await create({ tenant_id: '33333333-3333-4333-8333-333333333333' })).status).toBe(404);
    expect((await patch({ action: 'extend' })).status).toBe(400);
    expect((await patch({ action: 'explode' })).status).toBe(400);
  });

  it('stop blocks the tenant immediately; extend reopens it', async () => {
    expect((await patch({ action: 'stop' })).status).toBe(200);
    expect(db.tables.calldesk_pilots[0].status).toBe('stopped');
    expect(db.tables.calldesk_tenants[0]).toMatchObject({ pilot_blocked: true, pilot_blocked_reason: 'stopped' });
    const res = await patch({ action: 'extend', days: 7, minutes: 25 });
    expect(res.status).toBe(200);
    expect(db.tables.calldesk_pilots[0].status).toBe('active');
    expect(Number(db.tables.calldesk_pilots[0].minutes_cap)).toBe(75);
    expect(db.tables.calldesk_tenants[0].pilot_blocked).toBe(false);
  });

  it('convert clears the block; unknown pilot is 404', async () => {
    await patch({ action: 'stop' });
    await patch({ action: 'convert' });
    expect(db.tables.calldesk_pilots[0].status).toBe('converted');
    expect(db.tables.calldesk_tenants[0].pilot_blocked).toBe(false);
    const r = await onePATCH(req('/x', { method: 'PATCH', body: JSON.stringify({ action: 'stop' }) }), ctx('44444444-4444-4444-8444-444444444444'));
    expect(r.status).toBe(404);
  });
});
