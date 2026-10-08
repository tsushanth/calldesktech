import { it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/outreach/adminAuth', () => ({ requireAdminSession: vi.fn() }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { GET } from '@/app/api/admin/outreach/worker/route';

const req = (qs = '') => new NextRequest(`https://example.com/api/admin/outreach/worker${qs}`);

type Counts = { delivered: number; needsManual: number; failed: number; d24: number; n24: number; f24: number; byEmail: number };

// A chainable query whose awaited result depends on the table and on how it was filtered.
function db(opts: { rows: unknown[]; leads: unknown[]; counts: Counts; error?: unknown }) {
  const seen: string[] = [];
  const make = (table: string, head: boolean) => {
    const filters: string[] = [];
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit']) b[m] = () => b;
    b.eq = (k: string, v: string) => { filters.push(`${k}=${v}`); return b; };
    b.gte = (k: string) => { filters.push(`${k}>=`); return b; };
    b.in = (k: string, v: string[]) => { filters.push(`${k} in ${v.join(',')}`); return b; };
    (b as unknown as PromiseLike<unknown>).then = (resolve: (v: unknown) => unknown) => {
      const f = filters.join('&');
      seen.push(`${table}${head ? '#count' : ''}:${f}`);
      if (opts.error) return Promise.resolve({ data: null, count: null, error: opts.error }).then(resolve);
      if (table === 'calldesk_outreach_leads') return Promise.resolve({ data: opts.leads, error: null }).then(resolve);
      if (!head) return Promise.resolve({ data: opts.rows, error: null }).then(resolve);
      const recent = f.includes('created_at>=');
      const c = opts.counts;
      const n = f.includes('proof=email') ? c.byEmail
        : f.includes('outcome=submitted') ? (recent ? c.d24 : c.delivered)
        : f.includes('outcome=needs_manual') ? (recent ? c.n24 : c.needsManual)
        : (recent ? c.f24 : c.failed);
      return Promise.resolve({ count: n, error: null }).then(resolve);
    };
    return b;
  };
  return { from: (t: string) => ({ select: (_c: string, o?: { count?: string; head?: boolean }) => make(t, !!o?.head) }), seen };
}
const counts: Counts = { delivered: 11, needsManual: 20, failed: 2, d24: 5, n24: 12, f24: 1, byEmail: 1 };

beforeEach(() => { vi.mocked(requireAdminSession).mockReset(); vi.mocked(getSupabaseAdmin).mockReset(); });

it('refuses anyone who is not an admin', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue(null);
  expect((await GET(req())).status).toBe(401);
});

it('rejects an unknown outcome filter', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue({ email: 'o@example.com' });
  expect((await GET(req('?outcome=banana'))).status).toBe(400);
});

it('returns every attempt with where each lead stands now, and counts by outcome', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue({ email: 'o@example.com' });
  const mock = db({
    rows: [
      { id: 'a1', lead_id: 'l1', outcome: 'submitted', proof: 'page', company_name: 'Acme' },
      { id: 'a2', lead_id: 'l2', outcome: 'needs_manual', reason: 'phone required', company_name: 'Beta' },
      { id: 'a3', lead_id: null, outcome: 'failed', reason: 'timeout', company_name: 'Gone' },
    ],
    leads: [{ id: 'l1', fo_status: 'submitted' }, { id: 'l2', fo_status: 'submitted' }],
    counts,
  });
  vi.mocked(getSupabaseAdmin).mockReturnValue(mock as never);
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.rows.map((r: { id: string; lead_status: string | null }) => [r.id, r.lead_status])).toEqual([['a1', 'submitted'], ['a2', 'submitted'], ['a3', null]]);
  expect(body.counts).toEqual({
    all: { attempts: 33, delivered: 11, needsManual: 20, failed: 2 },
    last24h: { attempts: 18, delivered: 5, needsManual: 12, failed: 1 },
    byEmail: 1,
  });
  // no outcome filter on the list when "all"; the leads table is only asked about the ids shown
  expect(mock.seen.filter((s) => s.startsWith('calldesk_form_worker_log:'))[0]).toBe('calldesk_form_worker_log:');
  expect(mock.seen.find((s) => s.startsWith('calldesk_outreach_leads'))).toContain('in l1,l2');
});

it('filters the list by outcome', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue({ email: 'o@example.com' });
  const mock = db({ rows: [{ id: 'a2', lead_id: 'l2', outcome: 'needs_manual' }], leads: [{ id: 'l2', fo_status: 'needs_manual' }], counts });
  vi.mocked(getSupabaseAdmin).mockReturnValue(mock as never);
  const res = await GET(req('?outcome=needs_manual'));
  expect(res.status).toBe(200);
  expect(mock.seen).toContain('calldesk_form_worker_log:outcome=needs_manual');
});

it('reports a database error instead of an empty tab', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue({ email: 'o@example.com' });
  vi.mocked(getSupabaseAdmin).mockReturnValue(db({ rows: [], leads: [], counts, error: { message: 'relation does not exist' } }) as never);
  const res = await GET(req());
  expect(res.status).toBe(500);
  expect((await res.json()).error).toContain('relation');
});
