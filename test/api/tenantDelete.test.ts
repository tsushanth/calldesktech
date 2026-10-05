import { it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/retell', () => ({ getRetellClient: vi.fn() }));
vi.mock('@/lib/authz', () => ({ authorizeTenant: vi.fn(), requireTenantRole: vi.fn() }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { requireTenantRole } from '@/lib/authz';
import { DELETE } from '@/app/api/tenants/[id]/route';

// Each table call pops the next scripted result; deletes are recorded.
function supabaseMock(script: { tenantRow?: unknown; ownedCount?: number; numberCount?: number; deleteError?: string }) {
  const deleted: string[] = [];
  const client = {
    deleted,
    from(table: string) {
      let isDelete = false; let head = false;
      const b: Record<string, unknown> = {};
      b.select = (_c?: string, opts?: { head?: boolean }) => { head = !!opts?.head; return b; };
      b.delete = () => { isDelete = true; return b; };
      b.eq = () => b;
      b.maybeSingle = async () => ({ data: script.tenantRow ?? null, error: null });
      (b as unknown as PromiseLike<unknown>).then = (resolve: (v: unknown) => unknown) => {
        if (isDelete) { deleted.push(table); return Promise.resolve({ error: script.deleteError ? { message: script.deleteError } : null }).then(resolve); }
        if (head) return Promise.resolve({ count: table === 'calldesk_phone_numbers' ? (script.numberCount ?? 0) : (script.ownedCount ?? 2), error: null }).then(resolve);
        return Promise.resolve({ data: null, error: null }).then(resolve);
      };
      return b;
    },
  };
  return client;
}

const ctx = { params: Promise.resolve({ id: 't1' }) };
const req = () => new NextRequest('https://example.com/api/tenants/t1', { method: 'DELETE' });
const tenantRow = { id: 't1', user_id: 'u1', name: 'Acme' };

beforeEach(() => {
  vi.mocked(requireTenantRole).mockResolvedValue({ ok: true, principal: { userId: 'u1', via: 'session' }, tenantId: 't1' } as never);
});

it('deletes a workspace that is not the last one and has no phone numbers', async () => {
  const sb = supabaseMock({ tenantRow, ownedCount: 2, numberCount: 0 });
  vi.mocked(getSupabaseAdmin).mockReturnValue(sb as never);
  const res = await DELETE(req(), ctx);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ deleted: true, id: 't1' });
  expect(sb.deleted).toEqual(['calldesk_tenants']);
});

it('refuses to delete the only workspace', async () => {
  const sb = supabaseMock({ tenantRow, ownedCount: 1 });
  vi.mocked(getSupabaseAdmin).mockReturnValue(sb as never);
  const res = await DELETE(req(), ctx);
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/only workspace/i);
  expect(sb.deleted).toEqual([]);
});

it('refuses while the workspace still has phone numbers (they would stay billed)', async () => {
  const sb = supabaseMock({ tenantRow, ownedCount: 3, numberCount: 2 });
  vi.mocked(getSupabaseAdmin).mockReturnValue(sb as never);
  const res = await DELETE(req(), ctx);
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/2 phone numbers/);
  expect(sb.deleted).toEqual([]);
});

it('returns the authorization failure untouched, and only owners may delete', async () => {
  vi.mocked(requireTenantRole).mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 }) } as never);
  const sb = supabaseMock({ tenantRow });
  vi.mocked(getSupabaseAdmin).mockReturnValue(sb as never);
  expect((await DELETE(req(), ctx)).status).toBe(403);
  expect(requireTenantRole).toHaveBeenCalledWith(expect.anything(), 't1', ['owner'], { apiKeysAllowed: false });
  expect(sb.deleted).toEqual([]);
});

it('404s when the workspace does not exist', async () => {
  vi.mocked(getSupabaseAdmin).mockReturnValue(supabaseMock({ tenantRow: null }) as never);
  expect((await DELETE(req(), ctx)).status).toBe(404);
});
