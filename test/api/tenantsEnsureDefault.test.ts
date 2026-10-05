import { it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/retell', () => ({ getRetellClient: vi.fn() }));
vi.mock('@/lib/tenantProvisioning', () => ({ createBusinessTenant: vi.fn(), attachExistingAccountBilling: vi.fn().mockResolvedValue(undefined) }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { getServerSession } from 'next-auth';
import { attachExistingAccountBilling } from '@/lib/tenantProvisioning';
import { POST } from '@/app/api/tenants/route';

function supabaseMock(existing: unknown[], inserted: unknown = { id: 'new-tenant', name: "Sam's workspace" }) {
  const inserts: unknown[] = [];
  const client = {
    inserts,
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b;
      b.insert = (row: unknown) => { inserts.push({ table, row }); return b; };
      b.single = async () => ({ data: inserted, error: null });
      (b as unknown as PromiseLike<unknown>).then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: existing, error: null }).then(resolve);
      return b;
    },
  };
  return client;
}

const req = (body: unknown) => new NextRequest('https://example.com/api/tenants', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'user-1' } } as never);
  vi.mocked(attachExistingAccountBilling).mockClear();
});

it('ensureDefault returns the existing workspace and creates nothing when the user already has one', async () => {
  const sb = supabaseMock([{ id: 'old', name: 'Old' }]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(sb as never);
  const res = await POST(req({ name: "Sam's workspace", voiceEngine: 'poc', ensureDefault: true }));
  expect(res.status).toBe(200);
  expect((await res.json()).tenant.id).toBe('old');
  expect(sb.inserts).toHaveLength(0);
});

it('ensureDefault creates a poc workspace for a user with none', async () => {
  const sb = supabaseMock([]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(sb as never);
  const res = await POST(req({ name: "Sam's workspace", voiceEngine: 'poc', ensureDefault: true }));
  expect(res.status).toBe(201);
  expect((await res.json()).tenant.id).toBe('new-tenant');
  expect(sb.inserts).toHaveLength(1);
  expect(attachExistingAccountBilling).toHaveBeenCalledOnce();
});

it('without ensureDefault, an explicit create still makes a new workspace (add another workspace)', async () => {
  const sb = supabaseMock([{ id: 'old', name: 'Old' }]);
  vi.mocked(getSupabaseAdmin).mockReturnValue(sb as never);
  const res = await POST(req({ name: 'Second', voiceEngine: 'poc' }));
  expect(res.status).toBe(201);
  expect(sb.inserts).toHaveLength(1);
});

it('rejects an unauthenticated request', async () => {
  vi.mocked(getServerSession).mockResolvedValue(null as never);
  vi.mocked(getSupabaseAdmin).mockReturnValue(supabaseMock([]) as never);
  expect((await POST(req({ name: 'x', ensureDefault: true }))).status).toBe(401);
});
