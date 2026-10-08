import { it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/outreach/adminAuth', () => ({ requireAdminSession: vi.fn() }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { GET, PATCH } from '@/app/api/admin/outreach/worker/route';

const get = (qs = '') => new NextRequest(`https://example.com/api/admin/outreach/worker${qs}`);
const patch = (body: unknown) =>
  new NextRequest('https://example.com/api/admin/outreach/worker', { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

type Call = { table: string; op: 'select' | 'update'; head: boolean; filters: string[]; payload?: Record<string, unknown> };

// A chainable query: every call is recorded, and `answer` decides what awaiting it returns.
function db(answer: (c: Call) => { data?: unknown; count?: number | null; error?: unknown }) {
  const calls: Call[] = [];
  const make = (table: string, op: Call['op'], head: boolean, payload?: Record<string, unknown>) => {
    const call: Call = { table, op, head, filters: [], payload };
    calls.push(call);
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit']) b[m] = () => b;
    const f = (name: string) => (k: string, v?: unknown) => { call.filters.push(v === undefined ? `${name} ${k}` : `${name} ${k}=${String(v)}`); return b; };
    b.eq = f('eq'); b.neq = f('neq'); b.is = f('is'); b.gte = f('gte'); b.in = f('in');
    b.not = (k: string, op2: string, v: unknown) => { call.filters.push(`not ${k} ${op2} ${String(v)}`); return b; };
    b.maybeSingle = () => Promise.resolve({ error: null, ...answer(call) });
    (b as { then: unknown }).then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null, ...answer(call) }).then(resolve);
    return b;
  };
  return {
    calls,
    from: (t: string) => ({
      select: (_c: string, o?: { head?: boolean }) => make(t, 'select', !!o?.head),
      update: (p: Record<string, unknown>) => make(t, 'update', false, p),
    }),
  };
}

const admin = { email: 'o@example.com' };
beforeEach(() => { vi.mocked(requireAdminSession).mockReset(); vi.mocked(getSupabaseAdmin).mockReset(); });

/* ---------------------------------- GET ---------------------------------- */

const list = (rows: unknown[], leads: unknown[]) => (c: Call) => {
  if (c.table === 'calldesk_outreach_leads') return { data: leads };
  if (!c.head) return { data: rows };
  const recent = c.filters.some((x) => x.startsWith('gte created_at'));
  const f = c.filters.join('&');
  if (f.includes('not dismissed_at')) return { count: 4 }; // done by the human
  if (f.includes('proof=email')) return { count: 1 };
  if (f.includes('outcome=submitted')) return { count: recent ? 5 : 11 };
  if (f.includes('outcome=needs_manual')) return { count: recent ? 12 : 20 };
  return { count: recent ? 1 : 2 };
};

it('refuses anyone who is not an admin', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue(null);
  expect((await GET(get())).status).toBe(401);
  expect((await PATCH(patch({ id: 'a1' }))).status).toBe(401);
});

it('rejects an unknown outcome filter', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue(admin);
  expect((await GET(get('?outcome=banana'))).status).toBe(400);
});

it('returns every attempt with where the lead stands now, the message to paste for open ones, and the counts', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue(admin);
  const mock = db(list(
    [
      { id: 'a1', lead_id: 'l1', outcome: 'submitted', dismissed_at: null },
      { id: 'a2', lead_id: 'l2', outcome: 'needs_manual', dismissed_at: null },
      { id: 'a3', lead_id: 'l2', outcome: 'needs_manual', dismissed_at: '2026-10-08T00:00:00Z' },
      { id: 'a4', lead_id: null, outcome: 'failed', dismissed_at: null },
    ],
    [{ id: 'l1', fo_status: 'submitted', fo_subject: 's1', fo_body: 'b1' }, { id: 'l2', fo_status: 'needs_manual', fo_subject: 's2', fo_body: 'b2' }],
  ));
  vi.mocked(getSupabaseAdmin).mockReturnValue(mock as never);
  const res = await GET(get());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.rows.map((r: { id: string; lead_status: string | null; message: unknown }) => [r.id, r.lead_status, r.message])).toEqual([
    ['a1', 'submitted', null], // delivered: nothing to paste
    ['a2', 'needs_manual', { subject: 's2', body: 'b2' }],
    ['a3', 'needs_manual', null], // done by the human: no longer needs a message
    ['a4', null, null],
  ]);
  expect(body.counts).toEqual({
    all: { attempts: 37, delivered: 11, needsManual: 20, failed: 2, done: 4 },
    last24h: { attempts: 18, delivered: 5, needsManual: 12, failed: 1 },
    byEmail: 1,
  });
  expect(mock.calls.find((c) => c.table === 'calldesk_outreach_leads')?.filters).toContain('in id=l1,l2');
});

it('leaves what the human finished out of needs-you and failed, but not out of "all tried" or delivered', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue(admin);
  const needs = db(list([], []));
  vi.mocked(getSupabaseAdmin).mockReturnValue(needs as never);
  await GET(get('?outcome=needs_manual'));
  const rowsQuery = (m: ReturnType<typeof db>) => m.calls.find((c) => c.table === 'calldesk_form_worker_log' && !c.head)!;
  expect(rowsQuery(needs).filters).toEqual(['eq outcome=needs_manual', 'is dismissed_at=null']);

  const all = db(list([], []));
  vi.mocked(getSupabaseAdmin).mockReturnValue(all as never);
  await GET(get());
  expect(rowsQuery(all).filters).toEqual([]);

  const delivered = db(list([], []));
  vi.mocked(getSupabaseAdmin).mockReturnValue(delivered as never);
  await GET(get('?outcome=submitted'));
  expect(rowsQuery(delivered).filters).toEqual(['eq outcome=submitted']);
});

it('reports a database error instead of an empty tab', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue(admin);
  vi.mocked(getSupabaseAdmin).mockReturnValue(db(() => ({ data: null, count: null, error: { message: 'relation does not exist' } })) as never);
  const res = await GET(get());
  expect(res.status).toBe(500);
  expect((await res.json()).error).toContain('relation');
});

/* --------------------------------- PATCH --------------------------------- */

const LOG = 'calldesk_form_worker_log';
const LEADS = 'calldesk_outreach_leads';

function patchDb(row: unknown, lead: unknown) {
  return db((c) => {
    if (c.table === LOG && c.op === 'select') return { data: row };
    if (c.table === LEADS && c.op === 'select') return { data: lead };
    return {};
  });
}

it('needs an attempt id, and an attempt that exists', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue(admin);
  vi.mocked(getSupabaseAdmin).mockReturnValue(patchDb(null, null) as never);
  expect((await PATCH(patch({}))).status).toBe(400);
  expect((await PATCH(patch({ id: 'nope' }))).status).toBe(404);
});

it('refuses to mark a delivered attempt', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue(admin);
  vi.mocked(getSupabaseAdmin).mockReturnValue(patchDb({ id: 'a1', lead_id: 'l1', outcome: 'submitted' }, null) as never);
  expect((await PATCH(patch({ id: 'a1' }))).status).toBe(409);
});

it('Done marks the lead submitted so the worker never retries it, and dismisses every open attempt of that lead', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue(admin);
  const mock = patchDb(
    { id: 'a2', lead_id: 'l2', outcome: 'needs_manual' },
    { id: 'l2', signals: { other: 1, formOutreach: { status: 'needs_manual', reason: 'unconfirmed', body: 'hi' } } },
  );
  vi.mocked(getSupabaseAdmin).mockReturnValue(mock as never);
  const res = await PATCH(patch({ id: 'a2' }));
  expect(res.status).toBe(200);

  const leadUpdate = mock.calls.find((c) => c.table === LEADS && c.op === 'update')!;
  const signals = leadUpdate.payload!.signals as { other: number; formOutreach: Record<string, unknown> };
  expect(signals.other).toBe(1);
  expect(signals.formOutreach).toMatchObject({ status: 'submitted', doneManuallyBy: 'o@example.com', body: 'hi' });
  expect(signals.formOutreach.reason).toBeUndefined();

  const dismiss = mock.calls.find((c) => c.table === LOG && c.op === 'update')!;
  expect(dismiss.payload).toMatchObject({ dismissed_by: 'o@example.com' });
  expect(dismiss.filters).toEqual(['is dismissed_at=null', 'neq outcome=submitted', 'eq lead_id=l2']);
});

it('Done leaves a lead the worker or a reply already finished alone, and still dismisses the attempt', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue(admin);
  for (const status of ['submitted', 'replied']) {
    const mock = patchDb({ id: 'a2', lead_id: 'l2', outcome: 'failed' }, { id: 'l2', signals: { formOutreach: { status } } });
    vi.mocked(getSupabaseAdmin).mockReturnValue(mock as never);
    expect((await PATCH(patch({ id: 'a2' }))).status).toBe(200);
    expect(mock.calls.some((c) => c.table === LEADS && c.op === 'update')).toBe(false);
    expect(mock.calls.some((c) => c.table === LOG && c.op === 'update')).toBe(true);
  }
});

it('Done on an attempt whose lead is gone dismisses just that attempt', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue(admin);
  const mock = patchDb({ id: 'a9', lead_id: null, outcome: 'failed' }, null);
  vi.mocked(getSupabaseAdmin).mockReturnValue(mock as never);
  expect((await PATCH(patch({ id: 'a9' }))).status).toBe(200);
  expect(mock.calls.find((c) => c.table === LOG && c.op === 'update')!.filters).toContain('eq id=a9');
});

it('reports a failed dismissal', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue(admin);
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    db((c) => (c.op === 'update' ? { error: { message: 'boom' } } : { data: { id: 'a9', lead_id: null, outcome: 'failed' } })) as never,
  );
  const res = await PATCH(patch({ id: 'a9' }));
  expect(res.status).toBe(500);
  expect((await res.json()).error).toBe('boom');
});
