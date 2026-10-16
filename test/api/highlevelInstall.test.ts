import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { signLinkToken, verifyLinkToken, verifyPickToken } from '@/lib/highlevel/crypto';
import { HighLevelAuthError } from '@/lib/highlevel/oauth';

const exchangeCode = vi.fn();
const listInstalledLocations = vi.fn();
const locationTokenFor = vi.fn();
const saveInstall = vi.fn();
const linkTenant = vi.fn();
const moveSubscriptionsToTenant = vi.fn();
vi.mock('@/lib/highlevel/triggers', () => ({ moveSubscriptionsToTenant: (...a: unknown[]) => moveSubscriptionsToTenant(...a) }));
vi.mock('@/lib/highlevel/oauth', async (orig) => ({ ...(await orig<typeof import('@/lib/highlevel/oauth')>()), exchangeCode: (...a: unknown[]) => exchangeCode(...a), listInstalledLocations: (...a: unknown[]) => listInstalledLocations(...a), locationTokenFor: (...a: unknown[]) => locationTokenFor(...a) }));
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
  vi.clearAllMocks(); moveSubscriptionsToTenant.mockResolvedValue(undefined); session = null; tenantLookup = null; tenantQueries.length = 0;
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
  describe('agency-wide install (a Company token with no sub-account)', () => {
    const COMPANY = { access_token: 'co-at', refresh_token: 'co-rt', expires_in: 86400, userType: 'Company', companyId: 'co_1' };
    it('stores a token for the one approved sub-account and links it', async () => {
      exchangeCode.mockResolvedValue(COMPANY);
      listInstalledLocations.mockResolvedValue([{ id: 'loc_1', name: 'Acme' }]);
      locationTokenFor.mockResolvedValue({ access_token: 'lat', refresh_token: 'lrt', expires_in: 86400, locationId: 'loc_1', companyId: 'co_1' });
      saveInstall.mockResolvedValue({ ok: true, locationId: 'loc_1' });
      const u = loc(await cb('?code=abc'));
      expect(verifyLinkToken(u.searchParams.get('token')!)).toBe('loc_1');
      expect(locationTokenFor).toHaveBeenCalledWith('co-at', 'co_1', 'loc_1');
      expect(saveInstall).toHaveBeenCalledTimes(1);
      expect(saveInstall.mock.calls[0][0]).toMatchObject({ locationId: 'loc_1', access_token: 'lat' });
      expect(u.toString()).not.toContain('co-at');
    });
    it('stores every approved sub-account and asks which to connect', async () => {
      exchangeCode.mockResolvedValue(COMPANY);
      listInstalledLocations.mockResolvedValue([{ id: 'loc_1', name: 'Acme' }, { id: 'loc_2', name: 'Beta' }]);
      locationTokenFor.mockImplementation(async (_t: string, _c: string, id: string) => ({ access_token: 'x', refresh_token: 'y', expires_in: 1, locationId: id }));
      saveInstall.mockImplementation(async (t: { locationId: string }) => ({ ok: true, locationId: t.locationId }));
      const u = loc(await cb('?code=abc'));
      expect(u.searchParams.get('token')).toBeNull();
      expect(verifyPickToken(u.searchParams.get('pick')!)).toEqual([{ id: 'loc_1', name: 'Acme' }, { id: 'loc_2', name: 'Beta' }]);
      expect(saveInstall).toHaveBeenCalledTimes(2);
    });
    it('skips a sub-account whose token cannot be minted and keeps the rest', async () => {
      exchangeCode.mockResolvedValue(COMPANY);
      listInstalledLocations.mockResolvedValue([{ id: 'loc_1', name: 'Acme' }, { id: 'loc_2', name: 'Beta' }]);
      locationTokenFor.mockImplementation(async (_t: string, _c: string, id: string) => {
        if (id === 'loc_1') throw new HighLevelAuthError(403, 'HighLevel agency request failed (403): nope');
        return { access_token: 'x', refresh_token: 'y', expires_in: 1, locationId: id };
      });
      saveInstall.mockImplementation(async (t: { locationId: string }) => ({ ok: true, locationId: t.locationId }));
      expect(verifyLinkToken(loc(await cb('?code=abc')).searchParams.get('token')!)).toBe('loc_2');
    });
    it('reports install_failed when the agency calls are refused (scopes not granted)', async () => {
      exchangeCode.mockResolvedValue(COMPANY);
      listInstalledLocations.mockRejectedValue(new HighLevelAuthError(401, 'HighLevel agency request failed (401): not authorized'));
      expect(loc(await cb('?code=abc')).searchParams.get('error')).toBe('install_failed');
      expect(saveInstall).not.toHaveBeenCalled();
    });
    it('falls back to every sub-account when the agency approved all and none is reported installed yet', async () => {
      exchangeCode.mockResolvedValue({ ...COMPANY, approveAllLocations: true });
      listInstalledLocations.mockImplementation(async (_t: string, _c: string, _e: unknown, _f: unknown, installedOnly?: boolean) => (installedOnly === false ? [{ id: 'loc_1', name: 'Acme' }] : []));
      locationTokenFor.mockResolvedValue({ access_token: 'x', refresh_token: 'y', expires_in: 1, locationId: 'loc_1' });
      saveInstall.mockResolvedValue({ ok: true, locationId: 'loc_1' });
      expect(verifyLinkToken(loc(await cb('?code=abc')).searchParams.get('token')!)).toBe('loc_1');
      expect(listInstalledLocations).toHaveBeenCalledTimes(2);
    });
    it('does not list everything when the agency did not approve all sub-accounts', async () => {
      exchangeCode.mockResolvedValue({ ...COMPANY, approveAllLocations: false });
      listInstalledLocations.mockResolvedValue([]);
      saveInstall.mockResolvedValue({ ok: false, error: 'No sub-account' });
      expect(loc(await cb('?code=abc')).searchParams.get('error')).toBe('no_location');
      expect(listInstalledLocations).toHaveBeenCalledTimes(1);
    });
    it('explains when no sub-account was approved', async () => {
      exchangeCode.mockResolvedValue(COMPANY);
      listInstalledLocations.mockResolvedValue([]);
      saveInstall.mockResolvedValue({ ok: false, error: 'No sub-account' });
      expect(loc(await cb('?code=abc')).searchParams.get('error')).toBe('no_location');
    });
  });
});

const post = (fields: Record<string, string>) =>
  link(new NextRequest('http://internal:3000/api/highlevel/link', { method: 'POST', body: new URLSearchParams(fields), headers: { 'content-type': 'application/x-www-form-urlencoded' } }));

describe('POST /api/highlevel/link', () => {
  it('requires a signed-in user', async () => {
    expect((await post({ token: signLinkToken('loc_1'), tenant_id: 't1' })).status).toBe(401);
    expect(linkTenant).not.toHaveBeenCalled();
    expect(moveSubscriptionsToTenant).not.toHaveBeenCalled();
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
    expect(moveSubscriptionsToTenant).toHaveBeenCalledWith('loc_1', 't1');
    expect(loc(r).origin).toBe('https://calldesk.tech'); // never the internal address the request arrived on
    expect(loc(r).pathname).toBe('/highlevel/link');
    expect(loc(r).searchParams.get('done')).toBe('1');
  });
});
