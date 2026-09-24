import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/outreach/adminAuth', () => ({ requireAdminSession: vi.fn(async () => ({ email: 'a@b.co' })) }));
const notCalls: unknown[][] = [];
let msgRows: Array<Record<string, unknown>> = [];
let msgError: unknown = null;
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'limit']) b[m] = () => b;
      b.not = (...a: unknown[]) => {
        notCalls.push(a);
        // emulate the DB: drop rows whose variant is null
        msgRows = msgRows.filter((r) => r.variant !== null && r.variant !== undefined);
        return b;
      };
      const result = () => (table === 'calldesk_outreach_messages' ? { data: msgRows, error: msgError } : { data: [], error: null });
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
      return b;
    },
  }),
}));

import { GET } from '@/app/api/admin/outreach/samples/stats/route';

beforeEach(() => { notCalls.length = 0; msgError = null; });

it('excludes null-variant messages so pre-feature sends never appear as plain', async () => {
  msgRows = [
    { id: 'm1', product: 'calldesk:freight', variant: null, lead: { replied_at: null } },
    { id: 'm2', product: 'calldesk:freight', variant: 'plain', lead: { replied_at: null } },
  ];
  const body = await (await GET()).json();
  expect(notCalls[0]).toEqual(['variant', 'is', null]);
  expect(body.stats).toHaveLength(1);
  expect(body.stats[0]).toMatchObject({ variant: 'plain', sent: 1 });
  expect(body.truncated).toBeUndefined();
});

it('flags truncation at the row cap and returns empty stats with a note when the column is missing', async () => {
  msgRows = Array.from({ length: 5000 }, (_, i) => ({ id: `m${i}`, product: 'calldesk', variant: 'plain', lead: null }));
  expect((await (await GET()).json()).truncated).toBe(true);
  msgError = { message: 'column variant does not exist' };
  const body = await (await GET()).json();
  expect(body.stats).toEqual([]);
  expect(body.note).toBeTruthy();
});
