import type { TierId } from '@/lib/pricingTiers';
import { isTierId } from '@/lib/pricingTiers';

// Stripe price ids for the pricing tiers. Read from the environment, never hardcoded, so the ids can be created (see
// scripts/stripe-create-tier-prices.mjs) and rotated without a code change, and so a deploy without them fails closed.
//
// Each id is a metered per-voice-SECOND price, the same unit as the legacy voice prices in USAGE_PRICES (src/lib/constants.ts):
// usage is reported in whole seconds and the price is the per-minute rate divided by 60. See docs/tiered-billing.md.
export const TIER_PRICE_ENV: Record<TierId, string> = {
  lite: 'STRIPE_TIER_LITE_PRICE',
  standard: 'STRIPE_TIER_STANDARD_PRICE',
  pro: 'STRIPE_TIER_PRO_PRICE',
};

/** The Stripe price id configured for a tier, or null when the env var is unset or blank. */
export function tierPriceId(tier: TierId | string): string | null {
  if (!isTierId(tier)) return null;
  const v = process.env[TIER_PRICE_ENV[tier]]?.trim();
  return v ? v : null;
}

/** True when billing for the tier is set up. A tier that is not configured must never be sold or run: its calls would go unbilled. */
export function tierBillingConfigured(tier: TierId | string): boolean {
  return tierPriceId(tier) !== null;
}

/** Thrown when a tiered operation is attempted while the tier's price env var is not set. */
export class TierBillingNotConfiguredError extends Error {
  constructor(public readonly tier: string) {
    super(`Billing for the ${tier} tier is not yet available.`);
    this.name = 'TierBillingNotConfiguredError';
  }
}
