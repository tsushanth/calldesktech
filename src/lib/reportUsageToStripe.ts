import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTenantUsageSplitSince } from './usage';
import { tierBillingConfigured, TIER_PRICE_ENV } from './tierBilling';
import type { TierId } from './pricingTiers';

// Reports metered usage (voice seconds + booking/transfer/message events) to
// Stripe via the Billing Meters API (stripe.billing.meterEvents.create).
//
// This is NOT a design choice between two equally-valid mechanisms: the
// installed `stripe` SDK (package.json "stripe": "^20.2.0") has no
// `subscriptionItems.createUsageRecord` method at all — Stripe removed the
// legacy usage-records API from newer SDK versions (confirmed by inspecting
// the loaded SDK object directly: `subscriptionItems` only exposes
// create/retrieve/update/list/del). The live USAGE_PRICES
// (src/lib/constants.ts) were confirmed via a real, read-only
// `GET /v1/prices/:id` call to have `recurring.usage_type: "metered"` with a
// `recurring.meter` id set — they are genuinely Meter-backed prices, not
// legacy metered-subscription-item prices. Billing Meters is the only
// mechanism that can report usage against them with this SDK.
//
// Each meter's `customer_mapping` is `{ type: "by_id", event_payload_key:
// "stripe_customer_id" }` (confirmed via `GET /v1/billing/meters/:id`), so
// events are reported against the tenant's Stripe CUSTOMER id
// (calldesk_businesses.stripe_customer_id), not a subscription item id.
//
// Real event names, confirmed the same way (one meter per dimension; the
// four voice-backend prices in USAGE_PRICES.voice all share the one voice
// meter, since they're the same billable quantity at different rates):
//   calldesktech_voice_seconds    (unit: seconds, NOT minutes)
//   calldesktech_booking_events
//   calldesktech_transfer_events
//   calldesktech_message_events
const METER_EVENT_NAMES = {
  voice: 'calldesktech_voice_seconds',
  booking: 'calldesktech_booking_events',
  transfer: 'calldesktech_transfer_events',
  message: 'calldesktech_message_events',
} as const;

// Pricing tiers (docs/tiered-billing.md): one meter per tier, same shape as the legacy voice meter (seconds, sum, customer mapped by
// stripe_customer_id). This cron is the only thing that reports usage to them. A call is reported exactly once: tier null (or an unknown
// tier id) on the legacy meters above, a known tier on that tier's meter below; tiered calls include booking/transfer/message events in
// the per-minute price, so no event counts are reported for them.
export const TIER_METER_EVENT_NAMES: Record<TierId, string> = {
  lite: 'calldesktech_voice_seconds_lite',
  standard: 'calldesktech_voice_seconds_standard',
  pro: 'calldesktech_voice_seconds_pro',
};

export type TenantUsageReportResult =
  | { tenantId: string; status: 'skipped_no_customer' }
  | { tenantId: string; status: 'baseline_initialized'; until: string }
  | { tenantId: string; status: 'skipped_zero_usage'; since: string | null; until: string }
  | { tenantId: string; status: 'reported'; since: string | null; until: string; recorded: Array<{ dimension: string; eventName: string; value: number; identifier: string }> }
  | { tenantId: string; status: 'error'; error: string };

type TenantRow = { id: string; last_usage_reported_at: string | null };
type BusinessRow = { tenant_id: string; stripe_customer_id: string | null };

// Floors a Date to the start of the current minute. Used as the reporting
// window's `until` boundary so that a retry issued within the same minute
// (e.g. a crashed job re-run by the same cron tick, or a manual re-POST)
// derives the exact same idempotency keys as the original attempt, and
// Stripe's idempotency-key cache (24h) dedupes it server-side instead of
// double-recording usage. A retry that lands in a *different* minute after
// a failed DB write (usage reported to Stripe but last_usage_reported_at
// not advanced) is the one residual gap this doesn't close — see the
// route's doc comment.
// Stripe rejects a meter event `identifier` longer than 100 characters. The previous format (`usage-report:<tenant uuid>:<dimension>:<ISO since>_<ISO until>`)
// was 105 characters for the voice dimension and longer for the others, so every tenant with billable usage failed with
// "Invalid string ... must be at most 100 characters" and its watermark never advanced. Windows are floored to the minute (floorToMinute),
// so minute precision keeps the key unique per window and identical on a same-minute retry: 3 + 36 + 1 + up to 14 + 1 + 27 = 82 characters.
export function compactMinute(d: Date | null): string {
  return d ? d.toISOString().slice(0, 16).replace(/[-:]/g, '') : 'epoch';
}
export function meterEventIdentifier(tenantId: string, dimension: string, periodKey: string): string {
  return `ur:${tenantId}:${dimension}:${periodKey}`;
}

export function floorToMinute(d: Date): Date {
  const floored = new Date(d);
  floored.setSeconds(0, 0);
  return floored;
}

export async function reportTenantUsageToStripe(
  supabase: SupabaseClient,
  stripe: Stripe,
  tenant: TenantRow,
  business: BusinessRow | null,
  now: Date = new Date()
): Promise<TenantUsageReportResult> {
  const tenantId = tenant.id;
  if (!business?.stripe_customer_id) {
    return { tenantId, status: 'skipped_no_customer' };
  }

  const until = floorToMinute(now);

  // Never reported before: don't guess how far back to backfill. A tenant
  // that predates this feature may have months of calldesk_call_logs that
  // were never billed through Stripe usage records at all (billing may have
  // been flat-rate, manually configured, or simply not enforced) — silently
  // reporting "usage since account creation" here could dump an unexpected
  // lump-sum charge onto their very next invoice. Instead, the first run
  // only establishes the watermark; real reporting starts on the next run
  // once there is an actual bounded window to measure.
  if (!tenant.last_usage_reported_at) {
    const { error: initError } = await supabase
      .from('calldesk_tenants')
      .update({ last_usage_reported_at: until.toISOString() })
      .eq('id', tenantId);
    if (initError) {
      return { tenantId, status: 'error', error: `Failed to initialize usage-reporting baseline: ${initError.message}` };
    }
    return { tenantId, status: 'baseline_initialized', until: until.toISOString() };
  }

  const since = new Date(tenant.last_usage_reported_at);
  if (since >= until) {
    return { tenantId, status: 'skipped_zero_usage', since: since.toISOString(), until: until.toISOString() };
  }

  let split;
  try {
    split = await getTenantUsageSplitSince(supabase, tenantId, since, until);
  } catch (err) {
    return { tenantId, status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
  const usage = split.legacy;

  // Fail loudly, before reporting anything, if a tier with calls in this window cannot be billed: reporting the rest and advancing the
  // watermark would leave those calls unbilled forever. The watermark stays put, so the next run retries the whole window.
  const unconfigured = split.byTier.filter((t) => !tierBillingConfigured(t.tier));
  if (unconfigured.length > 0) {
    return {
      tenantId,
      status: 'error',
      error: `Calls on the ${unconfigured.map((t) => t.tier).join(', ')} tier(s) cannot be reported: ${unconfigured.map((t) => TIER_PRICE_ENV[t.tier]).join(', ')} is not set. Nothing was reported or advanced for this tenant.`,
    };
  }

  type Dimension = { dimension: string; eventName: string; value: number };
  const allDimensions: Dimension[] = [
    { dimension: 'voice', eventName: METER_EVENT_NAMES.voice, value: usage.seconds },
    { dimension: 'booking', eventName: METER_EVENT_NAMES.booking, value: usage.bookings },
    { dimension: 'transfer', eventName: METER_EVENT_NAMES.transfer, value: usage.transfers },
    { dimension: 'message', eventName: METER_EVENT_NAMES.message, value: usage.messages },
    ...split.byTier.map((t) => ({ dimension: `voice_${t.tier}`, eventName: TIER_METER_EVENT_NAMES[t.tier], value: t.seconds })),
  ];
  const dimensions = allDimensions.filter((d) => d.value > 0);

  if (dimensions.length === 0) {
    return { tenantId, status: 'skipped_zero_usage', since: since?.toISOString() ?? null, until: until.toISOString() };
  }

  const periodKey = `${compactMinute(since)}_${compactMinute(until)}`;
  const recorded: Array<{ dimension: string; eventName: string; value: number; identifier: string }> = [];

  try {
    for (const dim of dimensions) {
      const eventName = dim.eventName;
      // Identifier doubles as Stripe's idempotency key for meter events (a
      // duplicate `identifier` within the ~24h dedup window is dropped
      // server-side), scoped per tenant/dimension/window so a retry within
      // the same minute can't double-report. Safe because `since`/`until`
      // are a non-overlapping, monotonically-advancing window per tenant
      // (gated by last_usage_reported_at) — this always reports NEW usage
      // for the window, never re-sums a prior one.
      const identifier = meterEventIdentifier(tenantId, dim.dimension, periodKey);
      await stripe.billing.meterEvents.create({
        event_name: eventName,
        identifier,
        timestamp: Math.floor(until.getTime() / 1000),
        payload: { stripe_customer_id: business.stripe_customer_id, value: String(dim.value) },
      });
      recorded.push({ dimension: dim.dimension, eventName, value: dim.value, identifier });
    }
  } catch (err) {
    return { tenantId, status: 'error', error: err instanceof Error ? err.message : String(err) };
  }

  const { error: updateError } = await supabase
    .from('calldesk_tenants')
    .update({ last_usage_reported_at: until.toISOString() })
    .eq('id', tenantId);
  if (updateError) {
    return { tenantId, status: 'error', error: `Reported to Stripe but failed to advance last_usage_reported_at: ${updateError.message}` };
  }

  return { tenantId, status: 'reported', since: since?.toISOString() ?? null, until: until.toISOString(), recorded };
}

// Runs the job across every tenant that has a linked Stripe subscription.
export async function runUsageReportingJob(supabase: SupabaseClient, stripe: Stripe, now: Date = new Date()) {
  const { data: businesses, error: bizError } = await supabase
    .from('calldesk_businesses')
    .select('tenant_id, stripe_customer_id')
    .not('stripe_customer_id', 'is', null);
  if (bizError) throw bizError;

  const tenantIds = (businesses ?? []).map((b) => b.tenant_id);
  if (tenantIds.length === 0) return { results: [] as TenantUsageReportResult[] };

  const { data: tenants, error: tenantError } = await supabase
    .from('calldesk_tenants')
    .select('id, last_usage_reported_at')
    .in('id', tenantIds);
  if (tenantError) throw tenantError;

  const businessByTenant = new Map((businesses ?? []).map((b) => [b.tenant_id, b as BusinessRow]));

  const results: TenantUsageReportResult[] = [];
  for (const tenant of tenants ?? []) {
    const result = await reportTenantUsageToStripe(supabase, stripe, tenant as TenantRow, businessByTenant.get(tenant.id) ?? null, now);
    results.push(result);
  }
  return { results };
}
