import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireTenantRole = vi.fn();
const authorizeTenant = vi.fn();
vi.mock('@/lib/authz', () => ({ requireTenantRole: (...a: unknown[]) => requireTenantRole(...a), authorizeTenant: (...a: unknown[]) => authorizeTenant(...a) }));

// Recording fake: every .eq() is logged; the row lookup resolves to `row`.
const eqs: Array<[string, unknown]> = [];
let row: { mulaw8k_storage_path: string } | null = { mulaw8k_storage_path: 't1/a1.raw' };
const removed: string[][] = [];
const query: any = {
  select: () => query, delete: () => query,
  eq: (c: string, v: unknown) => { eqs.push([c, v]); return query; },
  maybeSingle: async () => ({ data: row, error: null }),
  then: (res: (v: unknown) => void) => res({ error: null }),
};
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => query,
    storage: { from: () => ({ remove: async (p: string[]) => { removed.push(p); return { error: null }; }, download: async () => ({ data: new Blob([new Uint8Array([0xff, 0xce])]), error: null }) }) },
  }),
}));

const { DELETE } = await import('@/app/api/tenants/[id]/call-audio/[assetId]/route');
const { GET } = await import('@/app/api/tenants/[id]/call-audio/[assetId]/audio/route');

const ctx = { params: Promise.resolve({ id: 'tenant-1', assetId: 'a1' }) };
const req = (method: string) => new NextRequest('http://x/api', { method });
const denied = (status: number) => ({ ok: false, response: NextResponse.json({ error: 'nope' }, { status }) });

beforeEach(() => { vi.clearAllMocks(); eqs.length = 0; removed.length = 0; row = { mulaw8k_storage_path: 't1/a1.raw' }; });

describe('DELETE asset', () => {
  it('owner/admin only, and never touches storage for a denied caller', async () => {
    requireTenantRole.mockResolvedValue(denied(404));
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(404);
    expect(requireTenantRole).toHaveBeenCalledWith(expect.anything(), 'tenant-1', ['owner', 'admin'], { apiKeysAllowed: false });
    expect(removed).toHaveLength(0);
  });
  it('scopes the row lookup AND delete to the tenant (a guessed asset id from another tenant is a 404)', async () => {
    requireTenantRole.mockResolvedValue({ ok: true, tenantId: 'tenant-1' });
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(200);
    expect(eqs).toContainEqual(['tenant_id', 'tenant-1']);
    expect(eqs).toContainEqual(['id', 'a1']);
    expect(removed).toEqual([['t1/a1.raw']]);
    row = null;
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(404);
    expect(removed).toHaveLength(1); // nothing further removed
  });
});

describe('GET audio preview', () => {
  it('returns a playable WAV for an asset in the caller\'s tenant, 404 otherwise', async () => {
    authorizeTenant.mockResolvedValue({ ok: true, tenantId: 'tenant-1' });
    const res = await GET(req('GET'), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/wav');
    expect(eqs).toContainEqual(['tenant_id', 'tenant-1']);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    row = null;
    expect((await GET(req('GET'), ctx)).status).toBe(404);
  });
  it('denied caller gets the auth response', async () => {
    authorizeTenant.mockResolvedValue(denied(401));
    expect((await GET(req('GET'), ctx)).status).toBe(401);
  });
});
