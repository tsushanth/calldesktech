import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// authz.ts imports getSupabaseAdmin from '@/lib/supabase' — mock that
// module's export so we control every Supabase call the functions under
// test make, without touching a real database.
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: vi.fn(),
}));

// authz.ts also calls getServerSession (session auth) and getMobileUser
// (mobile JWT auth) to resolve a Principal — mock both so tests can drive
// each auth path deterministically.
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));
vi.mock('@/lib/mobile-auth', () => ({
  getMobileUser: vi.fn(),
}));

import { getSupabaseAdmin } from '@/lib/supabase';
import { getServerSession } from 'next-auth';
import { getMobileUser } from '@/lib/mobile-auth';
import { getRole, requireTenantRole, authorizeTenant } from '@/lib/authz';

type Row = { data: unknown; error: unknown } | null;

/**
 * Minimal stand-in for the Supabase query builder. Each call to
 * `.from(table)` pops the next queued result for that table and returns a
 * chainable object: every filter/verb method (`select`, `eq`, `update`,
 * `delete`, ...) returns the same object, and the object itself is
 * thenable (so code that awaits the chain directly, e.g.
 * `.update(...).eq(...).eq(...)`, resolves) as well as exposing
 * `.maybeSingle()` / `.single()` for code that calls those explicitly.
 */
function makeSupabaseMock(queueByTable: Record<string, Row[]>) {
  return {
    from(table: string) {
      const queue = queueByTable[table] ?? [];
      const result = queue.shift() ?? { data: null, error: null };
      const chainMethods = ['select', 'eq', 'neq', 'update', 'delete', 'insert', 'order', 'limit', 'ilike', 'is'];
      const builder: Record<string, unknown> = {};
      for (const m of chainMethods) {
        builder[m] = () => builder;
      }
      builder.maybeSingle = async () => result;
      builder.single = async () => result;
      // Make the builder itself awaitable, for chains with no terminal call.
      (builder as unknown as PromiseLike<unknown>).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return builder;
    },
  };
}

function req() {
  return new NextRequest('https://example.com/api/x');
}

beforeEach(() => {
  vi.mocked(getSupabaseAdmin).mockReset();
  vi.mocked(getServerSession).mockReset();
  vi.mocked(getMobileUser).mockReset();
});

describe('getRole', () => {
  it('returns owner for the literal calldesk_tenants.user_id even with no team_members row', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      makeSupabaseMock({
        calldesk_tenants: [{ data: { id: 'tenant-1' }, error: null }],
        // getRole returns early on owner match and never queries team_members,
        // but queue it anyway to prove that.
        calldesk_team_members: [{ data: null, error: null }],
      }) as never
    );
    const role = await getRole('owner-user', 'tenant-1');
    expect(role).toBe('owner');
  });

  it('returns the real role for an active team_members row', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      makeSupabaseMock({
        calldesk_tenants: [{ data: null, error: null }],
        calldesk_team_members: [{ data: { role: 'admin' }, error: null }],
      }) as never
    );
    const role = await getRole('member-user', 'tenant-1');
    expect(role).toBe('admin');
  });

  it('does not treat a revoked/invited (non-active) row as active', async () => {
    // The mock's .eq('status', 'active') filter is a no-op (always
    // chainable), so this simulates what the real Postgrest filter does:
    // a revoked/invited row never matches status=active and the query
    // returns no row.
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      makeSupabaseMock({
        calldesk_tenants: [{ data: null, error: null }],
        calldesk_team_members: [{ data: null, error: null }],
      }) as never
    );
    const role = await getRole('revoked-user', 'tenant-1');
    expect(role).toBeNull();
  });
});

describe('requireTenantRole — regression test for the api-key DELETE RBAC bug', () => {
  // Today's real bug: DELETE /api/tenants/[id]/api-keys/[keyId] used the
  // wrong authz check, letting a plain 'member' revoke API keys meant to be
  // owner/admin-only. This asserts requireTenantRole (the check the fixed
  // route now uses) actually denies 'member' when only ['owner','admin']
  // are allowed.
  it('denies a member-role caller when only owner/admin are allowed', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'member-user' } } as never);
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      makeSupabaseMock({
        // authorizeTenant: not the literal owner, but an active team member
        calldesk_tenants: [
          { data: null, error: null }, // authorizeTenant's owner check
          { data: null, error: null }, // getRole's owner check
        ],
        calldesk_team_members: [
          { data: { id: 'tm-1' }, error: null }, // authorizeTenant's active-member check
          { data: { role: 'member' }, error: null }, // getRole's role lookup
        ],
      }) as never
    );

    const result = await requireTenantRole(req(), 'tenant-1', ['owner', 'admin']);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });

  it('allows an admin-role caller when owner/admin are allowed', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-user' } } as never);
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      makeSupabaseMock({
        calldesk_tenants: [
          { data: null, error: null },
          { data: null, error: null },
        ],
        calldesk_team_members: [
          { data: { id: 'tm-1' }, error: null },
          { data: { role: 'admin' }, error: null },
        ],
      }) as never
    );

    const result = await requireTenantRole(req(), 'tenant-1', ['owner', 'admin']);
    expect(result.ok).toBe(true);
  });
});

describe('requireTenantRole — API key principals', () => {
  it('treats an API key principal as owner-equivalent by default (apiKeysAllowed unset)', async () => {
    const r = new NextRequest('https://example.com/api/x', {
      headers: { authorization: 'Bearer cdk_live_abc123' },
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      makeSupabaseMock({
        calldesk_api_keys: [
          { data: { id: 'key-1', tenant_id: 'tenant-1', user_id: 'owner-user', revoked_at: null }, error: null },
        ],
      }) as never
    );

    const result = await requireTenantRole(r, 'tenant-1', ['owner', 'admin']);
    expect(result.ok).toBe(true);
  });

  it('denies an API key principal when apiKeysAllowed is false', async () => {
    const r = new NextRequest('https://example.com/api/x', {
      headers: { authorization: 'Bearer cdk_live_abc123' },
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      makeSupabaseMock({
        calldesk_api_keys: [
          { data: { id: 'key-1', tenant_id: 'tenant-1', user_id: 'owner-user', revoked_at: null }, error: null },
        ],
      }) as never
    );

    const result = await requireTenantRole(r, 'tenant-1', ['owner', 'admin'], { apiKeysAllowed: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });
});

describe('authorizeTenant', () => {
  it('returns 404 (not 403) for a tenant the caller does not own or belong to', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'stranger' } } as never);
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      makeSupabaseMock({
        calldesk_tenants: [{ data: null, error: null }],
        calldesk_team_members: [{ data: null, error: null }],
      }) as never
    );
    const result = await authorizeTenant(req(), 'tenant-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });
});
