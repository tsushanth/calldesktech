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
