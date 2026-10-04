import type { SupabaseClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/stripe';
import { isTierId } from '@/lib/pricingTiers';
import { carrierOfRow, createdBeforeTiers, numberPlanForTiers, requireNumberPriceIds, type NumberCarrier, type NumberPlan } from '@/lib/numberAddOn';

// Stripe and database side of the premium phone number add-on (see numberAddOn.ts for the product and prices).
//
// The monthly line is a licensed item whose quantity is the number of BILLED numbers the tenant holds on the carrier; the inbound line is
// a metered item added once per subscription and reported by the daily usage cron. Both are always set from the database count (an absolute
// target), never "+1" or "-1", so a retry, a double click or a half-finished earlier attempt converges on the right quantity.
// calldesk_phone_numbers.addon_billed marks the numbers that were bought under the add-on: numbers bought before it existed, and every
// number a legacy flat-rate tenant buys, stay unbilled.

/** The add-on plan for a tenant, from the latest version of each of its agents and its creation date. Fails closed on query errors (throws). */
export async function tenantNumberPlan(supabase: SupabaseClient, tenantId: string): Promise<NumberPlan> {
  const { data: tenant, error: tenantError } = await supabase.from('calldesk_tenants').select('created_at').eq('id', tenantId).maybeSingle();
  if (tenantError) throw tenantError;
  const legacyFlatRate = createdBeforeTiers(tenant?.created_at);
  const { data: agents, error: agentsError } = await supabase.from('calldesk_agents').select('id').eq('tenant_id', tenantId);
  if (agentsError) throw agentsError;
  const agentIds = (agents ?? []).map((a: { id: string }) => a.id);
  if (agentIds.length === 0) return numberPlanForTiers([], { legacyFlatRate });
  const { data: versions, error } = await supabase.from('calldesk_agent_versions').select('agent_id, version_number, tier').in('agent_id', agentIds);
  if (error) throw error;
  const latest = new Map<string, { n: number; tier: string | null }>();
  for (const v of (versions ?? []) as Array<{ agent_id: string; version_number: number; tier: string | null }>) {
    const cur = latest.get(v.agent_id);
    if (!cur || v.version_number > cur.n) latest.set(v.agent_id, { n: v.version_number, tier: isTierId(v.tier) ? v.tier : null });
  }
  return numberPlanForTiers([...latest.values()].map((v) => v.tier), { legacyFlatRate });
}

/** How many of the tenant's purchased numbers on `carrier` are billed under the add-on. */
export async function billedNumberCount(supabase: SupabaseClient, tenantId: string, carrier: NumberCarrier): Promise<number> {
  const { data, error } = await supabase
    .from('calldesk_phone_numbers')
    .select('id, carrier')
    .eq('tenant_id', tenantId)
    .eq('source', 'purchased')
    .eq('addon_billed', true);
  if (error) throw error;
  return ((data ?? []) as Array<{ carrier: string | null }>).filter((r) => carrierOfRow(r.carrier) === carrier).length;
}

export type SetNumberCountResult = { status: 'synced' } | { status: 'no_subscription' };

/**
 * Makes the tenant's subscription carry `count` billed numbers on `carrier`: monthly item quantity = count and the metered inbound item
 * present when count > 0; both removed at 0. Idempotent. Throws NumberAddOnNotConfiguredError when the price env vars are unset (so a
 * purchase can never go free) and rethrows Stripe errors. `no_subscription` means there is nothing to attach to.
 */
export async function setNumberAddOnCount(supabase: SupabaseClient, tenantId: string, carrier: NumberCarrier, count: number): Promise<SetNumberCountResult> {
  const ids = requireNumberPriceIds(carrier);
  const { data: business } = await supabase.from('calldesk_businesses').select('stripe_subscription_id').eq('tenant_id', tenantId).maybeSingle();
  if (!business?.stripe_subscription_id) return { status: 'no_subscription' };

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(business.stripe_subscription_id);
  if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') return { status: 'no_subscription' };

  const monthly = subscription.items.data.find((i) => i.price.id === ids.monthly);
  const inbound = subscription.items.data.find((i) => i.price.id === ids.inbound);

  if (count <= 0) {
    if (monthly) await stripe.subscriptionItems.del(monthly.id, { proration_behavior: 'create_prorations' });
    // Usage already reported stays on the next invoice (clear_usage is left off on purpose).
    if (inbound) await stripe.subscriptionItems.del(inbound.id, { proration_behavior: 'none' });
    return { status: 'synced' };
  }

  if (!monthly) {
    await createItemOrAcceptRace(stripe, subscription.id, ids.monthly, { quantity: count, proration_behavior: 'create_prorations' }, count);
  } else if (monthly.quantity !== count) {
    await stripe.subscriptionItems.update(monthly.id, { quantity: count, proration_behavior: 'create_prorations' });
  }
  if (!inbound) {
    await createItemOrAcceptRace(stripe, subscription.id, ids.inbound, { proration_behavior: 'none' }, null);
  }
  return { status: 'synced' };
}

// No idempotency key on purpose (Stripe replays a failed result for a repeated key). If the create fails, look again: a concurrent request
// may have added the item already, in which case a licensed item is brought to the target quantity.
async function createItemOrAcceptRace(
  stripe: ReturnType<typeof getStripe>,
  subscriptionId: string,
  priceId: string,
  extra: { quantity?: number; proration_behavior: 'create_prorations' | 'none' },
  quantityTarget: number | null
): Promise<void> {
  try {
    await stripe.subscriptionItems.create({ subscription: subscriptionId, price: priceId, ...extra });
  } catch (err) {
    const again = await stripe.subscriptions.retrieve(subscriptionId).catch(() => null);
    const raced = again?.items.data.find((i) => i.price.id === priceId);
    if (!raced) throw err;
    if (quantityTarget !== null && raced.quantity !== quantityTarget) {
      await stripe.subscriptionItems.update(raced.id, { quantity: quantityTarget, proration_behavior: 'create_prorations' });
    }
  }
}
