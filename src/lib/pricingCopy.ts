import { PRICING_TIERS, tierById, type TierId } from '@/lib/pricingTiers';

// Customer-facing price copy for the public marketing pages, derived from src/lib/pricingTiers.ts so the wording cannot drift from
// the tiers. The pricing page and the dashboard tier picker read pricingTiers.ts directly; everything else (home page, compare pages,
// partner page, decks, llms.txt) uses these strings.
//
// Rules this file enforces:
//  - The lowest advertised price (Lite) is never shown without saying it is coming soon.
//  - Add-on amounts are not stated here (they are proposals); pages point to /pricing for them.
//  - Customer-facing prices only: no cost, margin or vendor-rate figures.

function tier(id: TierId) {
  const t = tierById(id);
  if (!t) throw new Error(`Unknown tier ${id}`);
  return t;
}

/** 6 -> "6¢". */
export function centsLabel(cents: number): string {
  return `${cents}¢`;
}

/** 6 -> "6 cents", 1 -> "1 cent". */
export function centsWords(cents: number): string {
  return `${cents} ${cents === 1 ? 'cent' : 'cents'}`;
}

export const LITE_CENTS = tier('lite').pricePerMinuteCents;
export const STANDARD_CENTS = tier('standard').pricePerMinuteCents;
export const PRO_CENTS = tier('pro').pricePerMinuteCents;

/** The tiers that can be bought today. */
export const LIVE_TIERS = PRICING_TIERS.filter((t) => t.availability === 'live');
/** The tiers announced but not purchasable yet. */
export const COMING_SOON_TIERS = PRICING_TIERS.filter((t) => t.availability === 'coming_soon');

/** The cheapest tier, which is only advertised together with QUALIFIER. */
const cheapest = [...PRICING_TIERS].sort((a, b) => a.pricePerMinuteCents - b.pricePerMinuteCents)[0];

export const HEADLINE = `Phone agents from ${centsWords(cheapest.pricePerMinuteCents)} a minute`;

/** Must always accompany HEADLINE: the advertised floor is not purchasable yet. */
export const QUALIFIER = (() => {
  const soon = COMING_SOON_TIERS.map((t) => t.name).join(' and ');
  const live = LIVE_TIERS.map((t) => `${t.name} ${centsWords(t.pricePerMinuteCents)}`).join(' and ');
  return `${soon} ${COMING_SOON_TIERS.length === 1 ? 'is' : 'are'} coming soon; ${live} ${LIVE_TIERS.length === 1 ? 'is' : 'are'} available now`;
})();

/** One line for a "pricing" sentence on any public page. */
export const HEADLINE_WITH_QUALIFIER = `${HEADLINE}. ${QUALIFIER}.`;

export const ADD_ONS_LINE = 'Add-ons are optional and priced per minute; amounts are on the pricing page.';

/** Carrier explanation shared by compare copy. */
export const CARRIER_SHORT = 'carrier billed separately on Lite and Standard';

const standard = tier('standard');
const pro = tier('pro');
const lite = tier('lite');

/** Comparison-table "us" cell, long form. */
export const US_RATE_LONG = `From ${centsLabel(standard.pricePerMinuteCents)}/min (Standard) or ${centsLabel(pro.pricePerMinuteCents)}/min with numbers included (Pro); Lite from ${centsLabel(lite.pricePerMinuteCents)}/min coming soon; ${CARRIER_SHORT}`;

/** Comparison-table "us" cell, medium width. */
export const US_RATE_MEDIUM = `${centsLabel(standard.pricePerMinuteCents)}/min Standard (carrier separate) or ${centsLabel(pro.pricePerMinuteCents)}/min Pro (numbers included); Lite ${centsLabel(lite.pricePerMinuteCents)}/min coming soon`;

/** Comparison-table "us" cell, narrow (stat cards). */
export const US_RATE_SHORT = `${centsLabel(standard.pricePerMinuteCents)} Standard, ${centsLabel(pro.pricePerMinuteCents)} Pro (Lite ${centsLabel(lite.pricePerMinuteCents)} coming soon)`;

/** "6¢ to 10¢" range of what can be bought today. */
export const LIVE_RANGE = `${centsLabel(Math.min(...LIVE_TIERS.map((t) => t.pricePerMinuteCents)))} to ${centsLabel(Math.max(...LIVE_TIERS.map((t) => t.pricePerMinuteCents)))}`;

/** Same range in words, ASCII only, for the decks ("6 to 10 cents"). */
export const LIVE_RANGE_WORDS = `${Math.min(...LIVE_TIERS.map((t) => t.pricePerMinuteCents))} to ${Math.max(...LIVE_TIERS.map((t) => t.pricePerMinuteCents))} cents`;

/** What a 2-minute call costs at the live tiers, in dollars ("$0.12 to $0.20"). */
export function twoMinuteCallRange(): string {
  const cents = LIVE_TIERS.map((t) => t.pricePerMinuteCents * 2);
  const d = (c: number) => `$${(c / 100).toFixed(2)}`;
  return `${d(Math.min(...cents))} to ${d(Math.max(...cents))}`;
}

/** Plain-text pricing block for llms.txt and similar. */
export function pricingPlainText(): string {
  const lines = PRICING_TIERS.map((t) => {
    const status = t.availability === 'coming_soon' ? ' (coming soon, not available to buy yet)' : '';
    const carrier = t.carrierMode === 'byo' ? 'phone carrier billed separately' : 'phone numbers and calling included';
    return `- ${t.name}: ${centsWords(t.pricePerMinuteCents)} per minute${status}; ${carrier}`;
  });
  return [...lines, `- ${HEADLINE_WITH_QUALIFIER}`, `- ${ADD_ONS_LINE}`].join('\n');
}
