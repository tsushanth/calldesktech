import { SupabaseClient } from '@supabase/supabase-js';
import { PRICING_TIERS, isTierId, type TierId } from '@/lib/pricingTiers';
import { carrierOfRow, type NumberCarrier } from '@/lib/numberAddOn';

// Shared usage-computation helpers. Both the billing page (billing/route.ts)
// and the usage page (usage/route.ts) independently re-derive "minutes this
// period" from calldesk_call_logs; this is the one place that math lives so
// the Stripe usage-reporting job (report-usage/route.ts) can't drift from
// what the dashboard shows the tenant.

export type CallOutcomeCounts = {
  calls: number;
  minutes: number;
  // Raw seconds, kept alongside the rounded `minutes` shown to tenants:
  // the Stripe voice meter (calldesktech_voice_seconds) bills in whole
  // seconds, and reporting Math.round(seconds/60) to it would be wrong by
  // up to 60x if seconds were mistaken for minutes, and lossy either way.
  seconds: number;
  bookings: number;
  transfers: number;
  messages: number;
};

// Sums calldesk_call_logs.duration_seconds -> whole minutes, rounded the
// same way billing/route.ts and usage/route.ts already do (Math.round of
// the total, not per-call rounding, so partial minutes across many short
// calls aren't over-counted).
export function summarizeCallLogs(
  rows: Array<{ duration_seconds: number | null; outcome: string | null }>
): CallOutcomeCounts {
  const totalSeconds = rows.reduce((sum, c) => sum + (c.duration_seconds ?? 0), 0);
  return {
    calls: rows.length,
    minutes: Math.round(totalSeconds / 60),
    seconds: totalSeconds,
    bookings: rows.filter((c) => c.outcome === 'booked').length,
    transfers: rows.filter((c) => c.outcome === 'transferred').length,
    messages: rows.filter((c) => c.outcome === 'voicemail').length,
  };
}

type CallLogRow = { duration_seconds: number | null; outcome: string | null; tier?: string | null };

// calldesk_call_logs.tier (migration 065) is written by the engine for calls served by a tiered agent version. Before that migration is
// applied the column does not exist; selecting it then fails with Postgres "undefined column" (42703), and every call is a legacy call.
// calldesk_call_logs.is_internal_test (migration 024) flags our own demo and mystery-shopper calls. They are never billed or counted as usage;
// `.neq(..., true)` rather than `.eq(..., false)` so a NULL row stays billable. If the column is missing the filter is dropped.
async function fetchCallLogs(supabase: SupabaseClient, tenantId: string, since: Date | null, until: Date): Promise<CallLogRow[]> {
  const run = async (columns: string, excludeInternal: boolean) => {
    let query = supabase.from('calldesk_call_logs').select(columns).eq('tenant_id', tenantId).lt('created_at', until.toISOString());
    if (excludeInternal) query = query.neq('is_internal_test', true);
    if (since) query = query.gte('created_at', since.toISOString());
    return query;
  };
  let columns = 'duration_seconds, outcome, tier';
  let excludeInternal = true;
  let res = await run(columns, excludeInternal);
  if (res.error && /is_internal_test/.test(res.error.message || '')) { excludeInternal = false; res = await run(columns, excludeInternal); }
  if (res.error && (res.error.code === '42703' || /\btier\b/.test(res.error.message || ''))) {
    columns = 'duration_seconds, outcome';
    res = await run(columns, excludeInternal);
  }
  if (res.error) throw res.error;
  return (res.data ?? []) as unknown as CallLogRow[];
}

// Fetches calldesk_call_logs for a tenant in [since, until) and summarizes
// them. `since` null means "from the beginning" (never-reported tenant).
// `legacyOnly` leaves out calls served by a tiered agent version: those are
// billed through their tier's own price, so the legacy voice and per-event
// meters (reportUsageToStripe.ts) must not count them a second time.
export async function getTenantUsageSince(
  supabase: SupabaseClient,
  tenantId: string,
  since: Date | null,
  until: Date = new Date(),
  opts: { legacyOnly?: boolean } = {}
): Promise<CallOutcomeCounts> {
  const rows = await fetchCallLogs(supabase, tenantId, since, until);
  // An unknown tier id counts as legacy, consistent with summarizeCallLogsByTier.
  return summarizeCallLogs(opts.legacyOnly ? rows.filter((r) => !isTierId(r.tier)) : rows);
}

export type TierUsageRow = {
  /** null = calls from versions published without a tier (the account's flat per-minute voice price). */
  tier: TierId | null;
  label: string;
  calls: number;
  minutes: number;
  seconds: number;
  /** Cents per minute this row is billed at, or null when it is not known (legacy rate could not be read from the subscription). */
  centsPerMinute: number | null;
  /** Charge for the period so far in cents (seconds at the per-minute rate), or null when the rate is unknown. */
  chargeCents: number | null;
  /** Tiered rows include booking, transfer and message events in the per-minute price. */
  eventsIncluded: boolean;
};

export const LEGACY_TIER_LABEL = 'Standard rate (legacy)';

/**
 * Groups call logs by tier: one row per tier that has calls, tiers in catalog order, the legacy (no tier) row last. A call with a tier
 * id this code does not know is counted as legacy rather than dropped. `legacyCentsPerMinute` is the account's current flat voice rate.
 */
export function summarizeCallLogsByTier(rows: CallLogRow[], legacyCentsPerMinute: number | null): TierUsageRow[] {
  const bucket = new Map<TierId | null, CallLogRow[]>();
  for (const r of rows) {
    const key: TierId | null = isTierId(r.tier) ? r.tier : null;
    bucket.set(key, [...(bucket.get(key) ?? []), r]);
  }
  const out: TierUsageRow[] = [];
  for (const t of [...PRICING_TIERS.map((p) => p.id), null] as Array<TierId | null>) {
    const group = bucket.get(t);
    if (!group) continue;
    const sum = summarizeCallLogs(group);
    const centsPerMinute = t ? PRICING_TIERS.find((p) => p.id === t)!.pricePerMinuteCents : legacyCentsPerMinute;
    out.push({
      tier: t,
      label: t ? PRICING_TIERS.find((p) => p.id === t)!.name : LEGACY_TIER_LABEL,
      calls: sum.calls,
      minutes: sum.minutes,
      seconds: sum.seconds,
      centsPerMinute,
      chargeCents: centsPerMinute === null ? null : Math.round((sum.seconds * centsPerMinute) / 60),
      eventsIncluded: t !== null,
    });
  }
  return out;
}

/** Per-tier usage for a tenant in [since, until), for the billing page. */
export async function getTenantUsageByTierSince(
  supabase: SupabaseClient,
  tenantId: string,
  since: Date | null,
  legacyCentsPerMinute: number | null,
  until: Date = new Date()
): Promise<TierUsageRow[]> {
  return summarizeCallLogsByTier(await fetchCallLogs(supabase, tenantId, since, until), legacyCentsPerMinute);
}

export type UsageSplit = {
  /** Calls with no tier (or an unknown tier id): billed on the legacy voice and per-event meters. */
  legacy: CallOutcomeCounts;
  /** Voice seconds per tier that has calls. Tiered calls include their events in the per-minute price, so only seconds are kept. */
  byTier: Array<{ tier: TierId; calls: number; seconds: number }>;
};

/**
 * Splits a window's calls so each call lands in exactly one place: legacy (tier null or unknown) or its tier. Used by the usage-reporting
 * cron so a call is billed once, on the legacy meters or on its tier's meter, never both and never neither.
 */
export async function getTenantUsageSplitSince(
  supabase: SupabaseClient,
  tenantId: string,
  since: Date | null,
  until: Date = new Date()
): Promise<UsageSplit> {
  const rows = await fetchCallLogs(supabase, tenantId, since, until);
  const legacy = summarizeCallLogs(rows.filter((r) => !isTierId(r.tier)));
  const byTier: UsageSplit['byTier'] = [];
  for (const t of PRICING_TIERS) {
    const sum = summarizeCallLogs(rows.filter((r) => r.tier === t.id));
    if (sum.calls > 0) byTier.push({ tier: t.id, calls: sum.calls, seconds: sum.seconds });
  }
  return { legacy, byTier };
}

export type NumberInboundUsage = Array<{ carrier: NumberCarrier; calls: number; seconds: number }>;

/**
 * INBOUND seconds in [since, until) to the numbers the tenant bought under the premium number add-on (calldesk_phone_numbers.addon_billed),
 * per carrier. These feed the separate number inbound meters (src/lib/numberAddOn.ts); the call's voice seconds are still billed on the
 * legacy or tier meters, so nothing here replaces or double counts them. Our own demo and mystery-shopper calls (is_internal_test) are
 * excluded, as everywhere else. Outbound calls are never counted: they use the customer's own carrier. Returns [] without touching the call
 * logs when the tenant has no billed numbers (and when the addon_billed column is not migrated yet).
 */
export async function getTenantNumberInboundUsageSince(
  supabase: SupabaseClient,
  tenantId: string,
  since: Date | null,
  until: Date = new Date()
): Promise<NumberInboundUsage> {
  const numbers = await supabase
    .from('calldesk_phone_numbers')
    .select('number, carrier')
    .eq('tenant_id', tenantId)
    .eq('source', 'purchased')
    .eq('addon_billed', true);
  if (numbers.error) {
    if (numbers.error.code === '42703' || /addon_billed/.test(numbers.error.message || '')) return [];
    throw numbers.error;
  }
  const carrierByNumber = new Map<string, NumberCarrier>();
  for (const n of (numbers.data ?? []) as Array<{ number: string; carrier: string | null }>) {
    const c = carrierOfRow(n.carrier);
    if (c) carrierByNumber.set(n.number, c);
  }
  if (carrierByNumber.size === 0) return [];

  const run = async (excludeInternal: boolean) => {
    let query = supabase
      .from('calldesk_call_logs')
      .select('to_number, duration_seconds')
      .eq('tenant_id', tenantId)
      .eq('direction', 'inbound')
      .in('to_number', [...carrierByNumber.keys()])
      .lt('created_at', until.toISOString());
    if (excludeInternal) query = query.neq('is_internal_test', true);
    if (since) query = query.gte('created_at', since.toISOString());
    return query;
  };
  let res = await run(true);
  if (res.error && /is_internal_test/.test(res.error.message || '')) res = await run(false);
  if (res.error) throw res.error;

  const totals = new Map<NumberCarrier, { calls: number; seconds: number }>();
  for (const r of (res.data ?? []) as unknown as Array<{ to_number: string | null; duration_seconds: number | null }>) {
    const carrier = r.to_number ? carrierByNumber.get(r.to_number) : undefined;
    if (!carrier) continue;
    const t = totals.get(carrier) ?? { calls: 0, seconds: 0 };
    t.calls += 1;
    t.seconds += r.duration_seconds ?? 0;
    totals.set(carrier, t);
  }
  return [...totals.entries()].map(([carrier, t]) => ({ carrier, ...t })).filter((t) => t.seconds > 0);
}
