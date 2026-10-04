import type { SupabaseClient } from '@supabase/supabase-js';
import { carrierOfRow } from '@/lib/numberAddOn';
import { billedNumberCount, setNumberAddOnCount } from '@/lib/numberAddOnBilling';
import { logAudit } from '@/lib/auditLog';

// Releasing the phone numbers we sold to a tenant that cancelled. Numbers are rented from the carrier, so a churned tenant's numbers must
// not stay on our account forever, but a customer who resubscribes soon should not lose its number: the Stripe webhook starts a grace
// period (release_after) on the tenant's PURCHASED numbers and clears it when the tenant subscribes again; a daily job
// (POST /api/cron/release-numbers) releases whatever is past due. Numbers the customer brought (source != 'purchased') are never touched.

export const RELEASE_GRACE_DAYS = 14;
/** Most numbers one run releases, so a bad day cannot release everything at once. The next run continues. */
export const MAX_RELEASES_PER_RUN = 25;
/** Subscription statuses that count as a live subscription (the tenant keeps its numbers). */
const LIVE_STATUSES = ['active', 'trialing', 'past_due'];

export type EngineReleaseResult = { ok: true; alreadyGone?: boolean } | { ok: false; status: number; error: string; unsupported?: boolean };

/**
 * POST /release-number on the engine (admin bearer). A 404 WITH a JSON error body means the carrier no longer has the number: already
 * gone, so a success. A 404 without one is an engine that has no such route yet: unsupported, nothing is released.
 */
export async function releaseViaEngine(phoneNumber: string, carrier: string): Promise<EngineReleaseResult> {
  const baseUrl = process.env.CALL_LOOP_POC_BASE_URL;
  const secret = process.env.CALL_LOOP_POC_TEST_CALL_SECRET;
  if (!baseUrl || !secret) return { ok: false, status: 500, error: 'CALL_LOOP_POC_BASE_URL/CALL_LOOP_POC_TEST_CALL_SECRET not configured' };
  try {
    const res = await fetch(`${baseUrl}/release-number`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: phoneNumber, carrier }),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    if (res.status === 404) {
      if (body?.error) return { ok: true, alreadyGone: true };
      return { ok: false, status: 501, error: 'Releasing purchased numbers is not available yet.', unsupported: true };
    }
    return { ok: false, status: res.status >= 400 ? res.status : 502, error: body?.error || 'The voice engine could not release the number' };
  } catch (err) {
    return { ok: false, status: 502, error: err instanceof Error ? err.message : 'Failed to reach the voice engine' };
  }
}

/** Tenants that share a Stripe subscription (one subscription can back several workspaces). */
export async function tenantIdsForSubscription(supabase: SupabaseClient, subscriptionId: string): Promise<string[]> {
  const { data, error } = await supabase.from('calldesk_businesses').select('tenant_id').eq('stripe_subscription_id', subscriptionId);
  if (error) throw error;
  return ((data ?? []) as Array<{ tenant_id: string }>).map((r) => r.tenant_id);
}

/** Starts the grace period on the tenants' purchased numbers. Only numbers without a date are touched, so a replayed webhook never extends it. */
export async function scheduleNumberRelease(supabase: SupabaseClient, tenantIds: string[], now: Date = new Date()): Promise<void> {
  if (tenantIds.length === 0) return;
  const releaseAfter = new Date(now.getTime() + RELEASE_GRACE_DAYS * 24 * 3600 * 1000).toISOString();
  const { error } = await supabase
    .from('calldesk_phone_numbers')
    .update({ release_after: releaseAfter })
    .in('tenant_id', tenantIds)
    .eq('source', 'purchased')
    .is('release_after', null);
  if (error) throw error;
}

/** The tenants have a live subscription again: cancel any pending release. */
export async function clearNumberRelease(supabase: SupabaseClient, tenantIds: string[]): Promise<void> {
  if (tenantIds.length === 0) return;
  const { error } = await supabase.from('calldesk_phone_numbers').update({ release_after: null }).in('tenant_id', tenantIds).not('release_after', 'is', null);
  if (error) throw error;
}

export type ReleaseOutcome = {
  id: string;
  tenantId: string;
  number: string;
  status: 'released' | 'already_gone' | 'kept_active_subscription' | 'engine_failed' | 'engine_unsupported' | 'delete_failed' | 'would_release';
  error?: string;
};

type DueRow = { id: string; tenant_id: string; number: string; carrier: string | null; addon_billed: boolean | null };

/**
 * Releases the purchased numbers whose grace period is over. Safe to retry: a row is deleted only after the carrier release succeeded (or
 * the carrier no longer had the number), and a repeated engine release of a gone number is a success. A tenant that has a live
 * subscription again keeps its numbers (the date is cleared). dry = true reports what would happen and changes nothing.
 */
export async function runNumberRelease(supabase: SupabaseClient, opts: { dry?: boolean; now?: Date; limit?: number } = {}) {
  const now = opts.now ?? new Date();
  const limit = Math.min(opts.limit ?? MAX_RELEASES_PER_RUN, MAX_RELEASES_PER_RUN);
  const { data, error } = await supabase
    .from('calldesk_phone_numbers')
    .select('id, tenant_id, number, carrier, addon_billed')
    .eq('source', 'purchased')
    .lt('release_after', now.toISOString())
    .order('release_after', { ascending: true })
    .limit(limit);
  if (error) throw error;
  const due = (data ?? []) as DueRow[];
  const outcomes: ReleaseOutcome[] = [];

  for (const row of due) {
    const base = { id: row.id, tenantId: row.tenant_id, number: row.number };
    const { data: business } = await supabase.from('calldesk_businesses').select('subscription_status').eq('tenant_id', row.tenant_id).maybeSingle();
    if (business && LIVE_STATUSES.includes(String(business.subscription_status))) {
      if (!opts.dry) await supabase.from('calldesk_phone_numbers').update({ release_after: null }).eq('id', row.id);
      outcomes.push({ ...base, status: 'kept_active_subscription' });
      continue;
    }
    if (opts.dry) {
      outcomes.push({ ...base, status: 'would_release' });
      continue;
    }
    const carrier = carrierOfRow(row.carrier);
    if (!carrier) {
      outcomes.push({ ...base, status: 'engine_failed', error: 'unknown carrier on the row; left in place' });
      continue;
    }
    const released = await releaseViaEngine(row.number, carrier);
    if (!released.ok) {
      outcomes.push({ ...base, status: released.unsupported ? 'engine_unsupported' : 'engine_failed', error: released.error });
      continue;
    }
    const { error: deleteError } = await supabase.from('calldesk_phone_numbers').delete().eq('id', row.id);
    if (deleteError) {
      outcomes.push({ ...base, status: 'delete_failed', error: deleteError.message });
      continue;
    }
    if (row.addon_billed === true) {
      try {
        // Normally 'no_subscription' (it is cancelled); when the subscription still exists this drops the item quantity.
        await setNumberAddOnCount(supabase, row.tenant_id, carrier, await billedNumberCount(supabase, row.tenant_id, carrier));
      } catch (err) {
        console.error('[release-numbers] number released but its Stripe add-on quantity could not be updated; reconcile by hand', { tenantId: row.tenant_id }, err);
      }
    }
    await logAudit({
      tenantId: row.tenant_id,
      actorUserId: null,
      action: 'number.release',
      resourceType: 'phone_number',
      resourceId: row.id,
      metadata: { number: row.number, carrier, reason: 'subscription_canceled_grace_elapsed', alreadyGone: released.alreadyGone === true },
    });
    outcomes.push({ ...base, status: released.alreadyGone ? 'already_gone' : 'released' });
  }

  return { dry: opts.dry === true, due: due.length, limit, outcomes };
}
