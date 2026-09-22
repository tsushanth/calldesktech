import { it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Regression test for today's real bug: DELETE
// /api/tenants/[id]/api-keys/[keyId] used the wrong authz check, letting a
// plain 'member' revoke API keys meant to be owner/admin-only.

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/mobile-auth', () => ({ getMobileUser: vi.fn() }));
vi.mock('@/lib/auditLog', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { getServerSession } from 'next-auth';
import { logAudit } from '@/lib/auditLog';
import { DELETE } from '@/app/api/tenants/[id]/api-keys/[keyId]/route';

type Row = { data: unknown; error: unknown };

function makeSupabaseMock(queueByTable: Record<string, Row[]>) {
  return {
    from(table: string) {
      const queue = queueByTable[table] ?? [];
      const result = queue.shift() ?? { data: null, error: null };
      const chainMethods = ['select', 'eq', 'neq', 'update', 'delete', 'insert', 'order', 'limit'];
      const builder: Record<string, unknown> = {};
      for (const m of chainMethods) builder[m] = () => builder;
      builder.maybeSingle = async () => result;
      builder.single = async () => result;
      (builder as unknown as PromiseLike<unknown>).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return builder;
    },
  };
}

function makeRequest() {
  return new NextRequest('https://example.com/api/tenants/tenant-1/api-keys/key-1', { method: 'DELETE' });
}

function makeContext() {
  return { params: Promise.resolve({ id: 'tenant-1', keyId: 'key-1' }) };
}

beforeEach(() => {
  vi.mocked(getSupabaseAdmin).mockReset();
  vi.mocked(getServerSession).mockReset();
  vi.mocked(logAudit).mockClear();
});

it('a member-role caller gets 403 and the key is not revoked', async () => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'member-user' } } as never);
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    makeSupabaseMock({
      calldesk_tenants: [{ data: null, error: null }], // authorizeTenant owner check: not owner
      calldesk_team_members: [
        { data: { id: 'tm-1' }, error: null }, // authorizeTenant active-member check
        { data: { role: 'member' }, error: null }, // getRole lookup
      ],
    }) as never
  );

  const response = await DELETE(makeRequest(), makeContext());

  expect(response.status).toBe(403);
  expect(logAudit).not.toHaveBeenCalled();
});

it('an admin-role caller succeeds and an audit log entry is written', async () => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-user' } } as never);
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    makeSupabaseMock({
      calldesk_tenants: [{ data: null, error: null }],
      calldesk_team_members: [
        { data: { id: 'tm-1' }, error: null },
        { data: { role: 'admin' }, error: null },
      ],
      calldesk_api_keys: [{ data: null, error: null }], // the revoke update itself
    }) as never
  );

  const response = await DELETE(makeRequest(), makeContext());
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body).toEqual({ success: true });
  expect(logAudit).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'apikey.revoke', tenantId: 'tenant-1', resourceId: 'key-1' })
  );
});

it('an API key principal is denied (apiKeysAllowed: false on this route)', async () => {
  const request = new NextRequest('https://example.com/api/tenants/tenant-1/api-keys/key-1', {
    method: 'DELETE',
    headers: { authorization: 'Bearer cdk_live_abc123' },
  });
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    makeSupabaseMock({
      calldesk_api_keys: [
        { data: { id: 'key-2', tenant_id: 'tenant-1', user_id: 'owner-user', revoked_at: null }, error: null },
      ],
    }) as never
  );

  const response = await DELETE(request, makeContext());
  expect(response.status).toBe(403);
});
