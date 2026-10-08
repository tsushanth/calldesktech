import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/outreach/adminAuth', () => ({ requireAdminSession: vi.fn() }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { GET } from '@/app/api/admin/outreach/worker/route';

// A chainable query whose awaited result depends on how it was filtered.
function db(rows: unknown[], counts: { total: number; last24h: number; byEmail: number; needHuman: number }, error: unknown = null) {
  const calls: string[] = [];
  const make = (kind: 'rows' | 'count') => {
    let filters: string[] = [];
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit']) b[m] = () => b;
    b.eq = (k: string, v: string) => { filters.push(`${k}=${v}`); return b; };
    b.neq = (k: string, v: string) => { filters.push(`${k}!=${v}`); return b; };
    b.gte = (k: string) => { filters.push(`${k}>=`); return b; };
    (b as unknown as PromiseLike<unknown>).then = (resolve: (v: unknown) => unknown) => {
      calls.push(`${kind}:${filters.join('&')}`);
      if (error) return Promise.resolve({ data: null, count: null, error }).then(resolve);
      if (kind === 'rows') return Promise.resolve({ data: rows, error: null }).then(resolve);
      const f = filters.join('&');
      const n = f.includes('outcome!=') ? counts.needHuman : f.includes('proof=email') ? counts.byEmail : f.includes('created_at>=') ? counts.last24h : counts.total;
      return Promise.resolve({ count: n, error: null }).then(resolve);
    };
    return b;
  };
  return { from: () => ({ select: (_c: string, opts?: { count?: string }) => make(opts?.count ? 'count' : 'rows') }), calls };
}

beforeEach(() => { vi.mocked(requireAdminSession).mockReset(); vi.mocked(getSupabaseAdmin).mockReset(); });

it('refuses anyone who is not an admin', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue(null);
  expect((await GET()).status).toBe(401);
});

it('returns the delivered forms and the counts for the tab', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue({ email: 'owner@example.com' });
  const mock = db([{ id: 'r1', company_name: 'Acme', domain: 'acme.com', proof: 'page' }], { total: 11, last24h: 5, byEmail: 1, needHuman: 7 });
  vi.mocked(getSupabaseAdmin).mockReturnValue(mock as never);
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ rows: [{ id: 'r1', company_name: 'Acme', domain: 'acme.com', proof: 'page' }], counts: { total: 11, last24h: 5, byEmail: 1, needHumanLast24h: 7 } });
  expect(mock.calls.filter((c) => c.startsWith('rows:')).join()).toContain('outcome=submitted');
});

it('reports a database error instead of an empty tab', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue({ email: 'owner@example.com' });
  vi.mocked(getSupabaseAdmin).mockReturnValue(db([], { total: 0, last24h: 0, byEmail: 0, needHuman: 0 }, { message: 'relation does not exist' }) as never);
  const res = await GET();
  expect(res.status).toBe(500);
  expect((await res.json()).error).toContain('relation');
});
