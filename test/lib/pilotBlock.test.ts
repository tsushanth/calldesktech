import { describe, it, expect, vi } from 'vitest';
import { makeFakeDb } from '../helpers/fakePilotDb';
import {
  isTenantPilotBlocked, pilotBlockResponse, pilotBlockedBody, PILOT_BLOCKED_CODE,
  apiErrorText, apiFailureDetail, isPilotBlockedCall, excludePilotBlocked,
} from '@/lib/pilotBlock';

type Db = Parameters<typeof isTenantPilotBlocked>[0];
const dbWith = (tenants: Array<Record<string, unknown>>, opts = {}) => makeFakeDb({ calldesk_tenants: tenants }, opts) as unknown as Db;

describe('isTenantPilotBlocked', () => {
  it('true for a blocked tenant, false for an unblocked or unknown one', async () => {
    const db = dbWith([{ id: 'a', pilot_blocked: true }, { id: 'b', pilot_blocked: false }]);
    expect(await isTenantPilotBlocked(db, 'a')).toBe(true);
    expect(await isTenantPilotBlocked(db, 'b')).toBe(false);
    expect(await isTenantPilotBlocked(db, 'zzz')).toBe(false);
  });

  it('fails open only when the column is missing (migration not applied)', async () => {
    expect(await isTenantPilotBlocked(dbWith([{ id: 'a' }], { noFlagColumn: true }), 'a')).toBe(false);
  });

  it('throws on any other database error instead of failing open', async () => {
    const broken = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '57014', message: 'statement timeout' } }) }) }) }) } as unknown as Db;
    await expect(isTenantPilotBlocked(broken, 'a')).rejects.toThrow(/statement timeout/);
  });
});

describe('pilotBlockResponse', () => {
  it('null when the tenant may call (or there is no tenant, e.g. the public demo)', async () => {
    const db = dbWith([{ id: 'b', pilot_blocked: false }]);
    expect(await pilotBlockResponse(db, 'b')).toBeNull();
    expect(await pilotBlockResponse(db, null)).toBeNull();
  });

  it('403 { error, code, message } for a blocked tenant', async () => {
    const res = await pilotBlockResponse(dbWith([{ id: 'a', pilot_blocked: true }]), 'a');
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body).toEqual(pilotBlockedBody());
    expect(body.error).toBe('pilot_blocked');
    expect(body.code).toBe('pilot_blocked');
    expect(body.message).toMatch(/paused/i);
  });

  it('503 (fail closed) when the check itself errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '08006', message: 'connection failure' } }) }) }) }) } as unknown as Db;
    const res = await pilotBlockResponse(broken, 'a');
    expect(res!.status).toBe(503);
    expect((await res!.json()).code).toBe('pilot_check_failed');
    vi.restoreAllMocks();
  });
});

describe('error text helpers', () => {
  it('UI shows the friendly message for pilot_blocked, the plain error otherwise', () => {
    expect(apiErrorText(pilotBlockedBody(), 'x')).toBe(pilotBlockedBody().message);
    expect(apiErrorText({ error: 'Phone number not found' }, 'x')).toBe('Phone number not found');
    expect(apiErrorText({}, 'fallback')).toBe('fallback');
    expect(apiErrorText(null, 'fallback')).toBe('fallback');
  });

  it('MCP tool error names pilot_blocked', () => {
    expect(apiFailureDetail(pilotBlockedBody(), 403)).toBe(`${PILOT_BLOCKED_CODE}: ${pilotBlockedBody().message}`);
    expect(apiFailureDetail({ error: 'nope' }, 400)).toBe('nope');
    expect(apiFailureDetail(undefined, 502)).toBe('HTTP 502');
  });
});

describe('isPilotBlockedCall / excludePilotBlocked', () => {
  it('matches only analysis.blocked === "pilot"', () => {
    expect(isPilotBlockedCall({ analysis: { blocked: 'pilot' } })).toBe(true);
    expect(isPilotBlockedCall({ analysis: { blocked: 'other' } })).toBe(false);
    expect(isPilotBlockedCall({ analysis: { blocked: true } })).toBe(false);
    expect(isPilotBlockedCall({ analysis: null })).toBe(false);
    expect(isPilotBlockedCall({ analysis: ['pilot'] })).toBe(false);
    expect(isPilotBlockedCall({})).toBe(false);
    expect(isPilotBlockedCall(undefined)).toBe(false);
  });

  it('drops blocked rows and keeps the rest', () => {
    const rows = [{ id: 1, analysis: { blocked: 'pilot' } }, { id: 2, analysis: { summary: 'x' } }, { id: 3, analysis: null }];
    expect(excludePilotBlocked(rows).map((r) => r.id)).toEqual([2, 3]);
  });
});
