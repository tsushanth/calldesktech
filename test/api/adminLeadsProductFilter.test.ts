import { it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/outreach/adminAuth', () => ({ requireAdminSession: vi.fn() }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { GET } from '@/app/api/admin/outreach/leads/route';

const ROWS = [
  { id: '1', product: 'calldesk' },
  { id: '2', product: 'calldesk:freight' },
  { id: '3', product: 'kreativekoala:voxkey' },
  { id: '4', product: 'readaloud:api' },
  { id: '5', product: 'mcp' },
];

// A chainable query over ROWS that applies the recorded product filters the way PostgREST would.
function fakeDb() {
  const filters: string[] = [];
  const preds: ((p: string) => boolean)[] = [];
  const like = (pat: string) => (p: string) => p.startsWith(pat.replace(/%$/, ''));
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.order = () => b;
  b.limit = () => b;
  b.eq = (k: string, v: string) => { filters.push(`eq ${k}=${v}`); preds.push((p) => p === v); return b; };
  b.like = (k: string, v: string) => { filters.push(`like ${k}=${v}`); preds.push(like(v)); return b; };
  b.or = (expr: string) => {
    filters.push(`or ${expr}`);
    const parts = expr.split(',').map((x) => x.split('.'));
    preds.push((p) => parts.some(([, op, ...rest]) => (op === 'eq' ? p === rest.join('.') : like(rest.join('.'))(p))));
    return b;
  };
  (b as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: ROWS.filter((r) => preds.every((f) => f(r.product))), error: null }).then(resolve);
  return { filters, client: { from: () => b } };
}

const get = (qs = '') => new NextRequest(`https://example.com/api/admin/outreach/leads${qs}`);
const idsFor = async (qs: string) => {
  const d = fakeDb();
  vi.mocked(getSupabaseAdmin).mockReturnValue(d.client as never);
  const res = await GET(get(qs));
  expect(res.status).toBe(200);
  return { ids: ((await res.json()).leads as { id: string }[]).map((l) => l.id), filters: d.filters };
};

beforeEach(() => {
  vi.mocked(requireAdminSession).mockReset().mockResolvedValue({ email: 'o@example.com' } as never);
  vi.mocked(getSupabaseAdmin).mockReset();
});

it('401s without an admin session', async () => {
  vi.mocked(requireAdminSession).mockResolvedValue(null as never);
  expect((await GET(get())).status).toBe(401);
});

it('no product param applies no product filter (every product returned, as before)', async () => {
  const r = await idsFor('');
  expect(r.ids).toEqual(['1', '2', '3', '4', '5']);
  expect(r.filters).toEqual([]);
});

it('empty or "all" product param is the same as none', async () => {
  expect((await idsFor('?product=')).filters).toEqual([]);
  expect((await idsFor('?product=all')).filters).toEqual([]);
});

it('product=mcp returns only exact mcp rows', async () => {
  const r = await idsFor('?product=mcp');
  expect(r.ids).toEqual(['5']);
  expect(r.filters).toEqual(['eq product=mcp']);
});

it('calldesk, kreativekoala and readaloud use the same group forms as the sender lanes', async () => {
  expect((await idsFor('?product=calldesk')).ids).toEqual(['1', '2']);
  expect((await idsFor('?product=kreativekoala')).ids).toEqual(['3']);
  expect((await idsFor('?product=readaloud')).ids).toEqual(['4']);
});

it('an unknown product returns an empty list, not an error', async () => {
  const r = await idsFor('?product=nonsense');
  expect(r.ids).toEqual([]);
});
