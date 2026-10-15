import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decryptToken, encryptToken } from '@/lib/highlevel/crypto';
import { HighLevelAuthError } from '@/lib/highlevel/oauth';

type Row = Record<string, unknown>;
let rows: Row[] = [];
let calls: Array<{ op: string; patch?: Row; eq: Record<string, unknown> }> = [];

function table() {
  const state = { op: 'select', patch: undefined as Row | undefined, eq: {} as Record<string, unknown>, neq: {} as Record<string, unknown> };
  const run = () => {
    calls.push({ op: state.op, patch: state.patch, eq: { ...state.eq } });
    const hit = rows.filter((r) => Object.entries(state.eq).every(([k, v]) => r[k] === v) && Object.entries(state.neq).every(([k, v]) => r[k] !== v));
    if (state.op === 'update') { hit.forEach((r) => Object.assign(r, state.patch)); return hit; }
    return hit;
  };
  const b: Record<string, unknown> = {
    select: () => b,
    upsert: async (row: Row) => { const i = rows.findIndex((r) => r.location_id === row.location_id); if (i >= 0) rows[i] = { ...rows[i], ...row }; else rows.push({ ...row }); return { error: null }; },
    update: (patch: Row) => { state.op = 'update'; state.patch = patch; return b; },
    eq: (k: string, v: unknown) => { state.eq[k] = v; return b; },
    neq: (k: string, v: unknown) => { state.neq[k] = v; return b; },
    maybeSingle: async () => { const r = run()[0]; return { data: r ? { ...r } : null }; }, // a real database returns a copy
    then: (res: (v: unknown) => unknown) => res({ data: run().map((r) => ({ ...r })), error: null }),
  };
  return b;
}
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({ from: () => table() }) }));
import { saveInstall, getAccessToken, linkTenant, markCompanyUninstalled } from '@/lib/highlevel/installs';

const NOW = 1_800_000_000_000;
beforeEach(() => {
  rows = []; calls = [];
  vi.stubEnv('HIGHLEVEL_TOKEN_KEY', Buffer.alloc(32, 3).toString('base64'));
});
const tokens = { access_token: 'at1', refresh_token: 'rt1', expires_in: 86400, locationId: 'loc_1', companyId: 'co_1', userId: 'u_1' };

describe('saveInstall', () => {
  it('stores encrypted tokens and an expiry', async () => {
    expect(await saveInstall(tokens, NOW)).toEqual({ ok: true, locationId: 'loc_1' });
    const r = rows[0];
    expect(String(r.access_token)).not.toContain('at1');
    expect(decryptToken(String(r.access_token))).toBe('at1');
    expect(decryptToken(String(r.refresh_token))).toBe('rt1');
    expect(r.expires_at).toBe(new Date(NOW + 86_400_000).toISOString());
    expect(r.status).toBe('active');
  });
  it('refuses a token without a location', async () => {
    const r = await saveInstall({ ...tokens, locationId: undefined }, NOW);
    expect(r.ok).toBe(false);
    expect(rows).toHaveLength(0);
  });
  it('a reinstall keeps the workspace link', async () => {
    await saveInstall(tokens, NOW);
    rows[0].tenant_id = 'tenant_9';
    await saveInstall({ ...tokens, access_token: 'at2' }, NOW + 1000);
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe('tenant_9');
    expect(decryptToken(String(rows[0].access_token))).toBe('at2');
  });
});

describe('linkTenant', () => {
  it('links an active install and reports false when there is none', async () => {
    await saveInstall(tokens, NOW);
    expect(await linkTenant('loc_1', 'tenant_1', NOW)).toBe(true);
    expect(rows[0].tenant_id).toBe('tenant_1');
    expect(await linkTenant('loc_missing', 'tenant_1', NOW)).toBe(false);
  });
  it('does not link an uninstalled install', async () => {
    await saveInstall(tokens, NOW);
    rows[0].status = 'uninstalled';
    expect(await linkTenant('loc_1', 'tenant_1', NOW)).toBe(false);
  });
});

describe('getAccessToken', () => {
  it('returns the stored token while it is valid, with no refresh', async () => {
    await saveInstall(tokens, NOW);
    const refresh = vi.fn();
    expect(await getAccessToken('loc_1', { now: NOW + 60_000, refresh })).toBe('at1');
    expect(refresh).not.toHaveBeenCalled();
  });
  it('refreshes inside the five minute margin and stores the rotated pair', async () => {
    await saveInstall(tokens, NOW);
    const refresh = vi.fn(async () => ({ access_token: 'at2', refresh_token: 'rt2', expires_in: 86400 }));
    expect(await getAccessToken('loc_1', { now: NOW + 86_400_000 - 60_000, refresh })).toBe('at2');
    expect(refresh).toHaveBeenCalledWith('rt1');
    expect(decryptToken(String(rows[0].refresh_token))).toBe('rt2');
  });
  it('guards the write with the old refresh token so a concurrent refresh is not overwritten', async () => {
    await saveInstall(tokens, NOW);
    const staleEncrypted = String(rows[0].refresh_token);
    await getAccessToken('loc_1', { now: NOW + 86_400_000, refresh: async () => ({ access_token: 'at2', refresh_token: 'rt2', expires_in: 86400 }) });
    const update = calls.find((c) => c.op === 'update' && c.patch && 'refresh_token' in c.patch);
    expect(update?.eq.refresh_token).toBe(staleEncrypted);
  });
  it('uses the other request\'s tokens when it loses the race', async () => {
    await saveInstall(tokens, NOW);
    const refresh = vi.fn(async () => {
      // another request rotates the stored pair while this refresh is in flight
      rows[0].refresh_token = encryptToken('rt-other');
      rows[0].access_token = encryptToken('at-other');
      return { access_token: 'at-mine', refresh_token: 'rt-mine', expires_in: 86400 };
    });
    expect(await getAccessToken('loc_1', { now: NOW + 86_400_000, refresh })).toBe('at-other');
    expect(decryptToken(String(rows[0].refresh_token))).toBe('rt-other');
  });
  it('marks the install needs_reauth when HighLevel refuses the refresh token', async () => {
    await saveInstall(tokens, NOW);
    const refresh = vi.fn(async () => { throw new HighLevelAuthError(400, 'invalid_grant'); });
    await expect(getAccessToken('loc_1', { now: NOW + 86_400_000, refresh })).rejects.toThrow('invalid_grant');
    expect(rows[0].status).toBe('needs_reauth');
  });
  it('does not mark needs_reauth for a temporary HighLevel failure', async () => {
    await saveInstall(tokens, NOW);
    const refresh = vi.fn(async () => { throw new HighLevelAuthError(503, 'unavailable'); });
    await expect(getAccessToken('loc_1', { now: NOW + 86_400_000, refresh })).rejects.toThrow();
    expect(rows[0].status).toBe('active');
  });
  it('throws for an unknown or inactive install', async () => {
    await expect(getAccessToken('nope', { now: NOW })).rejects.toThrow(/not found/);
    await saveInstall(tokens, NOW);
    rows[0].status = 'uninstalled';
    await expect(getAccessToken('loc_1', { now: NOW })).rejects.toThrow(/uninstalled/);
  });
});

describe('markCompanyUninstalled', () => {
  it('marks every live install under the agency and returns those sub-accounts, leaving other agencies alone', async () => {
    await saveInstall({ ...tokens, locationId: 'loc_a', companyId: 'co_1' }, NOW);
    await saveInstall({ ...tokens, locationId: 'loc_b', companyId: 'co_1' }, NOW);
    await saveInstall({ ...tokens, locationId: 'loc_c', companyId: 'co_1' }, NOW);
    await saveInstall({ ...tokens, locationId: 'loc_d', companyId: 'co_2' }, NOW);
    rows.find((r) => r.location_id === 'loc_c')!.status = 'uninstalled'; // already gone
    expect((await markCompanyUninstalled('co_1', NOW)).sort()).toEqual(['loc_a', 'loc_b']);
    expect(rows.map((r) => [r.location_id, r.status])).toEqual([['loc_a', 'uninstalled'], ['loc_b', 'uninstalled'], ['loc_c', 'uninstalled'], ['loc_d', 'active']]);
  });
  it('returns nothing for an agency with no installs', async () => {
    expect(await markCompanyUninstalled('nobody', NOW)).toEqual([]);
  });
});
