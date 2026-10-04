import { describe, it, expect } from 'vitest';
import { summarizeCallLogsByTier, getTenantUsageSince, getTenantUsageByTierSince, LEGACY_TIER_LABEL } from '@/lib/usage';

const call = (tier: string | null | undefined, seconds: number, outcome: string | null = null) => ({ duration_seconds: seconds, outcome, tier });

describe('summarizeCallLogsByTier', () => {
  it('groups by tier in catalog order with legacy last, and charges seconds at each rate', () => {
    const rows = summarizeCallLogsByTier(
      [call(null, 600, 'booked'), call('pro', 300), call('standard', 1200), call('standard', 600), call(undefined, 60)],
      10
    );
    expect(rows.map((r) => r.tier)).toEqual(['standard', 'pro', null]);
    expect(rows[0]).toMatchObject({ label: 'Standard', calls: 2, minutes: 30, centsPerMinute: 5, chargeCents: 150, eventsIncluded: true });
    expect(rows[1]).toMatchObject({ label: 'Pro', calls: 1, minutes: 5, centsPerMinute: 9, chargeCents: 45 });
    expect(rows[2]).toMatchObject({ label: LEGACY_TIER_LABEL, calls: 2, minutes: 11, centsPerMinute: 10, chargeCents: 110, eventsIncluded: false });
  });
  it('legacy charge is unknown (null) when the subscription rate could not be read, minutes still shown', () => {
    const [row] = summarizeCallLogsByTier([call(null, 120)], null);
    expect(row).toMatchObject({ tier: null, minutes: 2, centsPerMinute: null, chargeCents: null });
  });
  it('an unknown tier id is counted as legacy, never dropped', () => {
    const rows = summarizeCallLogsByTier([call('platinum', 60)], 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].tier).toBeNull();
  });
  it('no calls gives no rows', () => {
    expect(summarizeCallLogsByTier([], 10)).toEqual([]);
  });
  it('charges by seconds, not rounded minutes', () => {
    const [row] = summarizeCallLogsByTier([call('standard', 30), call('standard', 30), call('standard', 30)], 10);
    expect(row.minutes).toBe(2); // 90s rounds to 2 for display
    expect(row.chargeCents).toBe(8); // 1.5 min x 5c = 7.5, rounded
  });
});

function fakeSupabase(rows: unknown[], opts: { noTierColumn?: boolean; noInternalColumn?: boolean } = {}) {
  const selects: string[] = [];
  const neqs: Array<[string, unknown]> = [];
  return {
    selects,
    neqs,
    client: {
      from: () => {
        let columns = '';
        const b: Record<string, unknown> = {};
        b.select = (c: string) => { columns = c; selects.push(c); return b; };
        b.eq = () => b; b.lt = () => b; b.gte = () => b;
        b.neq = (col: string, val: unknown) => { neqs.push([col, val]); return b; };
        b.then = (resolve: (v: unknown) => void) => {
          if (opts.noInternalColumn && neqs.length > 0 && !(b.__retried)) { neqs.length = 0; resolve({ data: null, error: { code: '42703', message: 'column calldesk_call_logs.is_internal_test does not exist' } }); return; }
          if (opts.noTierColumn && columns.includes('tier')) resolve({ data: null, error: { code: '42703', message: 'column "tier" does not exist' } });
          else resolve({ data: rows, error: null });
        };
        return b;
      },
    } as never,
  };
}

describe('getTenantUsageSince with tiers', () => {
  const rows = [call(null, 600, 'booked'), call('standard', 1200, 'booked'), call('pro', 60, 'transferred')];
  it('counts everything by default (dashboard totals)', async () => {
    const r = await getTenantUsageSince(fakeSupabase(rows).client, 't1', null, new Date());
    expect(r).toMatchObject({ calls: 3, seconds: 1860, bookings: 2, transfers: 1 });
  });
  it('legacyOnly leaves tiered calls out of the legacy meters (voice seconds and events)', async () => {
    const r = await getTenantUsageSince(fakeSupabase(rows).client, 't1', null, new Date(), { legacyOnly: true });
    expect(r).toMatchObject({ calls: 1, seconds: 600, bookings: 1, transfers: 0 });
  });
  it('before migration 065 (no tier column) everything is legacy and nothing breaks', async () => {
    const f = fakeSupabase([{ duration_seconds: 600, outcome: 'booked' }], { noTierColumn: true });
    const r = await getTenantUsageSince(f.client, 't1', null, new Date(), { legacyOnly: true });
    expect(r).toMatchObject({ calls: 1, seconds: 600 });
    expect(f.selects).toEqual(['duration_seconds, outcome, tier', 'duration_seconds, outcome']);
  });
  it('excludes internal test calls (demo, shopper) from usage, keeping NULL rows billable', async () => {
    const f = fakeSupabase(rows);
    await getTenantUsageSince(f.client, 't1', null, new Date());
    expect(f.neqs).toEqual([['is_internal_test', true]]);
  });
  it('before migration 024 (no is_internal_test column) the filter is dropped and nothing breaks', async () => {
    const f = fakeSupabase(rows, { noInternalColumn: true });
    const r = await getTenantUsageSince(f.client, 't1', null, new Date());
    expect(r).toMatchObject({ calls: 3, seconds: 1860 });
  });
  it('getTenantUsageByTierSince wires the query to the grouping', async () => {
    const out = await getTenantUsageByTierSince(fakeSupabase(rows).client, 't1', null, 10);
    expect(out.map((r) => r.tier)).toEqual(['standard', 'pro', null]);
  });
});
