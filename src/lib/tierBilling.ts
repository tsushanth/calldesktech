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

// GRANDFATHERING. Stripe prices are immutable, so a tier price change is a NEW price. A subscription keeps billing at whatever price its
// tier item was created with: nothing here ever swaps an existing item to the current env price. The tenant's real item is therefore the
// source of truth for what that tenant pays per minute; PRICING_TIERS is only the price for new items and the fallback when no item exists.
// An item is recognised as a tier's by its price id (the current env price) or by the price metadata that scripts/stripe-create-tier-prices.mjs
// stamps on every tier price (tier + unit=voice_seconds), which covers older prices of the same tier.

/** The parts of a Stripe subscription item this file reads (structural, so tests need no Stripe types). */
export type TierItemLike = {
  id?: string;
  price: {
    id: string;
    unit_amount_decimal?: string | null;
    transform_quantity?: { divide_by?: number | null } | null;
    metadata?: Record<string, string> | null;
  };
};

/** The tier a Stripe price belongs to: the current env price of a tier, or any price stamped with that tier's metadata. Null otherwise. */
export function tierOfPrice(price: TierItemLike['price']): TierId | null {
  for (const t of Object.keys(TIER_PRICE_ENV) as TierId[]) {
    if (tierPriceId(t) === price.id) return t;
  }
  const meta = price.metadata;
  if (meta && meta.unit === 'voice_seconds' && isTierId(meta.tier)) return meta.tier;
  return null;
}

/** The subscription item that already bills `tier`, whatever its price (old or current), or undefined. */
export function findTierItem<T extends TierItemLike>(items: T[], tier: TierId): T | undefined {
  return items.find((i) => tierOfPrice(i.price) === tier);
}

/** Cents per minute a metered per-second price bills, or null when it cannot be read. Same arithmetic as the legacy voice line. */
export function centsPerMinuteOfPrice(price: TierItemLike['price']): number | null {
  const unit = price.unit_amount_decimal ? Number(price.unit_amount_decimal) : NaN;
  if (!Number.isFinite(unit)) return null;
  const per = price.transform_quantity?.divide_by || 1;
  return Math.round((unit * 60 * 1000) / per) / 1000;
}

/** What each tier on this subscription actually bills per minute, read from its items. A tier with no item is absent (callers fall back to PRICING_TIERS). */
export function tierRatesFromItems(items: TierItemLike[]): Partial<Record<TierId, number>> {
  const out: Partial<Record<TierId, number>> = {};
  for (const i of items) {
    const t = tierOfPrice(i.price);
    const c = centsPerMinuteOfPrice(i.price);
    if (t && c !== null && out[t] === undefined) out[t] = c;
  }
  return out;
}
