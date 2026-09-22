import { it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/mobile-auth', () => ({ getMobileUser: vi.fn() }));
vi.mock('@/lib/auditLog', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { getServerSession } from 'next-auth';
import { logAudit } from '@/lib/auditLog';
import { DELETE } from '@/app/api/calls/[id]/route';

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
  return new NextRequest('https://example.com/api/calls/call-1', { method: 'DELETE' });
}
function makeContext() {
  return { params: Promise.resolve({ id: 'call-1' }) };
}

beforeEach(() => {
  vi.mocked(getSupabaseAdmin).mockReset();
  vi.mocked(getServerSession).mockReset();
  vi.mocked(logAudit).mockClear();
});

it('owner succeeds and writes an audit log entry with the right action', async () => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'owner-user' } } as never);
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    makeSupabaseMock({
      // authorizeResource: look up the call log's tenant_id
      calldesk_call_logs: [
        { data: { tenant_id: 'tenant-1' }, error: null }, // authorizeResource lookup
        { data: null, error: null }, // the delete itself
      ],
      // authorizeTenant runs twice (once via authorizeResource, once via
      // requireTenantRole), plus once more inside getRole — 3 owner checks.
      calldesk_tenants: [
        { data: { id: 'tenant-1' }, error: null },
        { data: { id: 'tenant-1' }, error: null },
        { data: { id: 'tenant-1' }, error: null },
      ],
    }) as never
  );

  const response = await DELETE(makeRequest(), makeContext());
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body).toEqual({ success: true });
  expect(logAudit).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'call.delete', tenantId: 'tenant-1', resourceId: 'call-1' })
  );
});

it('admin succeeds', async () => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-user' } } as never);
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    makeSupabaseMock({
      calldesk_call_logs: [
        { data: { tenant_id: 'tenant-1' }, error: null },
        { data: null, error: null },
      ],
      calldesk_tenants: [
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
      calldesk_team_members: [
        { data: { id: 'tm-1' }, error: null }, // authorizeTenant #1 active-member check
        { data: { id: 'tm-1' }, error: null }, // authorizeTenant #2 active-member check
        { data: { role: 'admin' }, error: null }, // getRole lookup
      ],
    }) as never
  );

  const response = await DELETE(makeRequest(), makeContext());
  expect(response.status).toBe(200);
});

it('member gets 403 and the call is not deleted', async () => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'member-user' } } as never);
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    makeSupabaseMock({
      calldesk_call_logs: [{ data: { tenant_id: 'tenant-1' }, error: null }],
      calldesk_tenants: [
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
      calldesk_team_members: [
        { data: { id: 'tm-1' }, error: null },
        { data: { id: 'tm-1' }, error: null },
        { data: { role: 'member' }, error: null },
      ],
    }) as never
  );

  const response = await DELETE(makeRequest(), makeContext());
  expect(response.status).toBe(403);
  expect(logAudit).not.toHaveBeenCalled();
});
