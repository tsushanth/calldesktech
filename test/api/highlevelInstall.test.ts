import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { signLinkToken, verifyLinkToken } from '@/lib/highlevel/crypto';
import { HighLevelAuthError } from '@/lib/highlevel/oauth';

const exchangeCode = vi.fn();
const saveInstall = vi.fn();
const linkTenant = vi.fn();
vi.mock('@/lib/highlevel/oauth', async (orig) => ({ ...(await orig<typeof import('@/lib/highlevel/oauth')>()), exchangeCode: (...a: unknown[]) => exchangeCode(...a) }));
vi.mock('@/lib/highlevel/installs', () => ({ saveInstall: (...a: unknown[]) => saveInstall(...a), linkTenant: (...a: unknown[]) => linkTenant(...a) }));

let session: { user?: { id?: string; email?: string } } | null = null;
vi.mock('next-auth', () => ({ getServerSession: async () => session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
let tenantLookup: { id: string } | null = null;
const tenantQueries: Array<Record<string, unknown>> = [];
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (k: string, v: unknown) => { q[k] = v; return b; },
        maybeSingle: async () => { tenantQueries.push({ ...q }); return { data: tenantLookup }; },
      };
      return b;
    },
  }),
}));

import { GET as callback } from '@/app/api/highlevel/oauth/callback/route';
import { POST as link } from '@/app/api/highlevel/link/route';

beforeEach(() => {
  vi.clearAllMocks(); session = null; tenantLookup = null; tenantQueries.length = 0;
  vi.stubEnv('HIGHLEVEL_TOKEN_KEY', Buffer.alloc(32, 5).toString('base64'));
  vi.stubEnv('HIGHLEVEL_LINK_SECRET', 'a-long-test-secret-value');
  vi.stubEnv('HIGHLEVEL_REDIRECT_URI', 'https://calldesk.tech/api/highlevel/oauth/callback');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const cb = (qs: string) => callback(new NextRequest(`http://internal:3000/api/highlevel/oauth/callback${qs}`));
const loc = (r: Response) => new URL(r.headers.get('location')!);

describe('GET /api/highlevel/oauth/callback', () => {
  it('stores the install and sends the browser to the link page with a signed token for that location', async () => {
    exchangeCode.mockResolvedValue({ access_token: 'at', refresh_token: 'rt', expires_in: 86400, locationId: 'loc_1' });
    saveInstall.mockResolvedValue({ ok: true, locationId: 'loc_1' });
    const r = await cb('?code=abc');
    expect(r.status).toBe(303);
    const u = loc(r);
    expect(u.origin).toBe('https://calldesk.tech');
    expect(u.pathname).toBe('/highlevel/link');
    expect(verifyLinkToken(u.searchParams.get('token')!)).toBe('loc_1');
    expect(exchangeCode).toHaveBeenCalledWith('abc');
    expect(u.toString()).not.toContain('at=');
    expect(u.toString()).not.toContain('rt');
  });
  it('treats a denied install as a normal outcome', async () => {
    const r = await cb('?error=access_denied');
    expect(loc(r).searchParams.get('error')).toBe('denied');
    expect(exchangeCode).not.toHaveBeenCalled();
  });
  it('rejects a request with no code', async () => {
    expect((await cb('')).status).toBe(400);
  });
  it('reports a failed exchange without leaking the reason, and logs only the safe message', async () => {
    exchangeCode.mockRejectedValue(new HighLevelAuthError(400, 'HighLevel token request failed (400): Invalid authorization code'));
    const r = await cb('?code=abc');
    expect(loc(r).searchParams.get('error')).toBe('install_failed');
    expect(loc(r).searchParams.get('token')).toBeNull();
    expect(saveInstall).not.toHaveBeenCalled();
  });
  it('explains an agency-level install that has no location', async () => {
    exchangeCode.mockResolvedValue({ access_token: 'at', refresh_token: 'rt', expires_in: 86400, companyId: 'co_1' });
    saveInstall.mockResolvedValue({ ok: false, error: 'No sub-account' });
    expect(loc(await cb('?code=abc')).searchParams.get('error')).toBe('no_location');
  });
});

const post = (fields: Record<string, string>) =>
  link(new NextRequest('http://internal:3000/api/highlevel/link', { method: 'POST', body: new URLSearchParams(fields), headers: { 'content-type': 'application/x-www-form-urlencoded' } }));

describe('POST /api/highlevel/link', () => {
  it('requires a signed-in user', async () => {
    expect((await post({ token: signLinkToken('loc_1'), tenant_id: 't1' })).status).toBe(401);
    expect(linkTenant).not.toHaveBeenCalled();
  });
  it('rejects a missing, tampered or expired token', async () => {
    session = { user: { id: 'u1' } };
    expect((await post({ tenant_id: 't1' })).status).toBe(400);
    expect((await post({ token: 'forged.token', tenant_id: 't1' })).status).toBe(400);
    expect((await post({ token: signLinkToken('loc_1', Date.now() - 2 * 3600_000), tenant_id: 't1' })).status).toBe(400);
    expect(linkTenant).not.toHaveBeenCalled();
  });
  it('only links a workspace the signed-in user owns', async () => {
    session = { user: { id: 'u1' } };
    tenantLookup = null;
    expect((await post({ token: signLinkToken('loc_1'), tenant_id: 'someone-elses' })).status).toBe(404);
    expect(tenantQueries[0]).toMatchObject({ id: 'someone-elses', user_id: 'u1' });
    expect(linkTenant).not.toHaveBeenCalled();
  });
  it('is a conflict when there is no active install behind the token', async () => {
    session = { user: { id: 'u1' } }; tenantLookup = { id: 't1' }; linkTenant.mockResolvedValue(false);
    expect((await post({ token: signLinkToken('loc_1'), tenant_id: 't1' })).status).toBe(409);
  });
  it('links the location in the token to the chosen workspace and sends the user to the done page', async () => {
    session = { user: { id: 'u1' } }; tenantLookup = { id: 't1' }; linkTenant.mockResolvedValue(true);
    const r = await post({ token: signLinkToken('loc_1'), tenant_id: 't1' });
    expect(r.status).toBe(303);
    expect(linkTenant).toHaveBeenCalledWith('loc_1', 't1');
    expect(loc(r).pathname).toBe('/highlevel/link');
    expect(loc(r).searchParams.get('done')).toBe('1');
  });
});
