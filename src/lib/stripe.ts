import Stripe from 'stripe';

// Lazy initialization to avoid build-time errors
let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not defined');
    }
    stripeInstance = new Stripe(secretKey, {
      apiVersion: '2025-12-15.clover',
      typescript: true,
    });
  }
  return stripeInstance;
}

// For backwards compatibility
export const stripe = {
  get checkout() {
    return getStripe().checkout;
  },
  get webhooks() {
    return getStripe().webhooks;
  },
};

export const STRIPE_CONFIG = {
  priceId: process.env.STRIPE_PRICE_ID || '',
  successUrl: `${process.env.NEXT_PUBLIC_APP_URL}/onboarding?session_id={CHECKOUT_SESSION_ID}`,
  cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/pricing`,
};

// Checkout only ever attaches the kokoro voice price (see checkout/route.ts
// — a tenant can't pick elevenlabs until an agent exists, which is after
// checkout). This was a disclosed gap: if a tenant later creates a 'poc'
// version with tts_backend: 'elevenlabs', their subscription kept billing
// the kokoro rate regardless. Called from agents/[id]/versions/route.ts
// whenever a poc-engine version sets a tts_backend, so the subscription's
// voice line item always matches what's actually configured.
//
// All four backends (kokoro/elevenlabs/cartesia/minimax) have a
// USAGE_PRICES.voice entry — see the comment there for how the cartesia/
// minimax rates were derived. This still no-ops gracefully for any future
// backend added without a price yet, same "don't guess" behavior as no
// existing voice line item to swap, rather than billing the wrong rate.
export async function syncVoicePriceForTenant(tenantId: string, ttsBackend: import('@/types').TtsBackend) {
  const { USAGE_PRICES } = await import('./constants');
  const { getSupabaseAdmin } = await import('./supabase');
  const targetPriceId: string | undefined = USAGE_PRICES.voice[ttsBackend as keyof typeof USAGE_PRICES.voice];
  if (!targetPriceId) return; // no Stripe price configured for this backend yet

  const supabase = getSupabaseAdmin();
  const { data: business } = await supabase
    .from('calldesk_businesses')
    .select('stripe_subscription_id')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!business?.stripe_subscription_id) return; // no active subscription yet — nothing to sync

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(business.stripe_subscription_id);
  const voicePriceIds: string[] = Object.values(USAGE_PRICES.voice);
  const currentVoiceItem = subscription.items.data.find((item) => voicePriceIds.includes(item.price.id));
  // No existing voice line item to swap (e.g. subscription predates this
  // pricing model) — don't guess at inserting one, just leave it alone.
  if (!currentVoiceItem || currentVoiceItem.price.id === targetPriceId) return;

  await stripe.subscriptionItems.update(currentVoiceItem.id, { price: targetPriceId });
}

export type EnsureTierItemResult =
  | { status: 'added'; itemId: string }
  | { status: 'already_present'; itemId: string }
  | { status: 'no_subscription' };

// Tiered billing (docs/tiered-billing.md): a version published with a tier is billed by the per-minute price of that tier, as a separate
// metered line on the tenant's subscription. This is the sibling of syncVoicePriceForTenant and deliberately different: it only ADDS
// the tier's item, never removes or swaps anything (the legacy voice item keeps billing legacy calls), and it is idempotent, so
// publishing again, retrying after a failure, or two publishes at once all end with exactly one item for the tier.
//
// Tenants with no subscription yet (trial, not checked out) get 'no_subscription' and nothing happens, the same as the voice sync; the
// Stripe webhook adds the items for tiers already in use when they check out. Throws TierBillingNotConfiguredError when the tier's price
// env var is unset, and rethrows any Stripe error: the caller must treat both as "the tiered agent is not billable yet".
export async function ensureTierItemForTenant(tenantId: string, tier: import('./pricingTiers').TierId): Promise<EnsureTierItemResult> {
  const { tierPriceId, TierBillingNotConfiguredError } = await import('./tierBilling');
  const { getSupabaseAdmin } = await import('./supabase');
  const priceId = tierPriceId(tier);
  if (!priceId) throw new TierBillingNotConfiguredError(tier);

  const supabase = getSupabaseAdmin();
  const { data: business } = await supabase
    .from('calldesk_businesses')
    .select('stripe_subscription_id')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!business?.stripe_subscription_id) return { status: 'no_subscription' };

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(business.stripe_subscription_id);
  if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') return { status: 'no_subscription' };

  const existing = subscription.items.data.find((item) => item.price.id === priceId);
  if (existing) return { status: 'already_present', itemId: existing.id };

  // Metered price: no quantity. No idempotency key on purpose: Stripe replays a failed result for a repeated key, which would make a retry
  // fail the same way. Instead, if the create fails, look again: a concurrent publish may have added the item already.
  try {
    const item = await stripe.subscriptionItems.create({ subscription: subscription.id, price: priceId, proration_behavior: 'none' });
    return { status: 'added', itemId: item.id };
  } catch (err) {
    const again = await stripe.subscriptions.retrieve(subscription.id).catch(() => null);
    const raced = again?.items.data.find((item) => item.price.id === priceId);
    if (raced) return { status: 'already_present', itemId: raced.id };
    throw err;
  }
}

// Checkout only attaches the legacy voice and event prices. A tenant that published tiered versions while still on a trial (no
// subscription, so ensureTierItemForTenant did nothing) would otherwise run tiered calls with no tier line to bill them on. The Stripe
// webhook calls this after checkout to add a line for every tier the tenant's agents already use. Returns the tiers that failed; never throws.
export async function ensureTierItemsInUseForTenant(tenantId: string): Promise<{ ensured: string[]; failed: string[] }> {
  const { getSupabaseAdmin } = await import('./supabase');
  const { isTierId } = await import('./pricingTiers');
  const supabase = getSupabaseAdmin();
  const ensured: string[] = [];
  const failed: string[] = [];
  try {
    const { data: agents } = await supabase.from('calldesk_agents').select('id').eq('tenant_id', tenantId);
    const agentIds = (agents ?? []).map((a: { id: string }) => a.id);
    if (agentIds.length === 0) return { ensured, failed };
    const { data: versions } = await supabase.from('calldesk_agent_versions').select('tier').in('agent_id', agentIds).not('tier', 'is', null);
    const tiers = [...new Set((versions ?? []).map((v: { tier: string | null }) => v.tier))].filter(isTierId);
    for (const tier of tiers) {
      try {
        await ensureTierItemForTenant(tenantId, tier);
        ensured.push(tier);
      } catch (err) {
        console.error('Failed to add tier item after checkout', { tenantId, tier }, err);
        failed.push(tier);
      }
    }
  } catch (err) {
    console.error('Tier item backfill after checkout failed', { tenantId }, err);
  }
  return { ensured, failed };
}
