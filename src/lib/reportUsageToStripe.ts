import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTenantUsageSince } from './usage';
import { USAGE_PRICES } from './constants';

// Reports metered usage (voice minutes + booking/transfer/message events)
// to Stripe against the legacy metered-price subscription-item usage-record
// API (stripe.subscriptionItems.createUsageRecord), not the newer Billing
// Meters/meterEvents API.
//
// Why the legacy mechanism: USAGE_PRICES (src/lib/constants.ts) holds
// concrete Stripe Price ids for voice/booking/transfer/message, and
// syncVoicePriceForTenant (src/lib/stripe.ts) already swaps the
// subscription's voice line item to whichever of those prices matches the
// tenant's tts_backend by finding the matching item on
// `subscription.items.data` — i.e. this app already treats each tenant's
// subscription as carrying one metered subscription item per dimension,
// found by price id, not tracked in our own DB. There is no
// subscription_item_id-style column on calldesk_businesses/calldesk_tenants,
// so nothing in the schema points at the newer meter-event model (which
// keys off customer + event name, not subscription items). Given that
// existing, working precedent, this job re-derives the subscription's
// current items the same way and posts usage records against them.
// Confidence: high for "legacy metered subscription items is what this app
// already uses", medium for "this is Stripe's recommended path going
// forward" — Stripe has been steering new integrations toward Billing
// Meters since 2023-10; if this app were built fresh today the meter-event
// API would likely be preferred. But retrofitting that would mean adding a
// second, parallel pricing model, not reusing what's already wired up.

export type TenantUsageReportResult =
  | { tenantId: string; status: 'skipped_no_subscription' }
  | { tenantId: string; status: 'baseline_initialized'; until: string }
  | { tenantId: string; status: 'skipped_zero_usage'; since: string | null; until: string }
  | { tenantId: string; status: 'reported'; since: string | null; until: string; recorded: Array<{ dimension: string; subscriptionItemId: string; quantity: number }> }
  | { tenantId: string; status: 'error'; error: string };

type TenantRow = { id: string; last_usage_reported_at: string | null };
type BusinessRow = { tenant_id: string; stripe_subscription_id: string | null };

// Floors a Date to the start of the current minute. Used as the reporting
// window's `until` boundary so that a retry issued within the same minute
// (e.g. a crashed job re-run by the same cron tick, or a manual re-POST)
// derives the exact same idempotency keys as the original attempt, and
// Stripe's idempotency-key cache (24h) dedupes it server-side instead of
// double-recording usage. A retry that lands in a *different* minute after
// a failed DB write (usage reported to Stripe but last_usage_reported_at
// not advanced) is the one residual gap this doesn't close — see the
// route's doc comment.
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
  if (!business?.stripe_subscription_id) {
    return { tenantId, status: 'skipped_no_subscription' };
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

  let usage;
  try {
    usage = await getTenantUsageSince(supabase, tenantId, since, until);
  } catch (err) {
    return { tenantId, status: 'error', error: err instanceof Error ? err.message : String(err) };
  }

  const dimensions: Array<{ dimension: string; priceIds: string[]; quantity: number }> = [
    { dimension: 'voice', priceIds: Object.values(USAGE_PRICES.voice), quantity: usage.minutes },
    { dimension: 'booking', priceIds: [USAGE_PRICES.booking], quantity: usage.bookings },
    { dimension: 'transfer', priceIds: [USAGE_PRICES.transfer], quantity: usage.transfers },
    { dimension: 'message', priceIds: [USAGE_PRICES.message], quantity: usage.messages },
  ].filter((d) => d.quantity > 0);

  if (dimensions.length === 0) {
    return { tenantId, status: 'skipped_zero_usage', since: since?.toISOString() ?? null, until: until.toISOString() };
  }

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(business.stripe_subscription_id);
  } catch (err) {
    return { tenantId, status: 'error', error: err instanceof Error ? err.message : String(err) };
  }

  const periodKey = `${since ? since.toISOString() : 'epoch'}_${until.toISOString()}`;
  const recorded: Array<{ dimension: string; subscriptionItemId: string; quantity: number }> = [];

  try {
    for (const dim of dimensions) {
      const item = subscription.items.data.find((i) => dim.priceIds.includes(i.price.id));
      if (!item) {
        // No subscription item at this price (e.g. subscription predates
        // this pricing dimension, or the tenant's plan doesn't include it)
        // — don't guess at attaching one, matches syncVoicePriceForTenant's
        // existing no-op behavior for the same situation.
        continue;
      }
      // action: 'increment' — this window's usage is additive on top of
      // whatever Stripe already has for the current billing period for
      // this item. Safe because `since`/`until` are a non-overlapping,
      // monotonically-advancing window per tenant (gated by
      // last_usage_reported_at), never re-summing a prior window. 'set'
      // was deliberately avoided: it would require this job to always
      // recompute the *whole* period's usage, which is a larger blast
      // radius if that computation is ever wrong.
      await stripe.subscriptionItems.createUsageRecord(
        item.id,
        { quantity: dim.quantity, timestamp: Math.floor(until.getTime() / 1000), action: 'increment' },
        { idempotencyKey: `usage-report:${tenantId}:${item.id}:${periodKey}` }
      );
      recorded.push({ dimension: dim.dimension, subscriptionItemId: item.id, quantity: dim.quantity });
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
    .select('tenant_id, stripe_subscription_id')
    .not('stripe_subscription_id', 'is', null);
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
