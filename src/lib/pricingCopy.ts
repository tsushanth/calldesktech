import { PRICING_TIERS, INCLUDED_ON_ALL, ratingsForStack, tierById, type TierId } from '@/lib/pricingTiers';
import { EXPERT_BACKUP, expertBackupAllowedTierNames, expertBackupPriceText } from '@/lib/expertBackup';
import { NUMBER_ADDON_PRICES, NUMBER_CARRIERS, type NumberCarrier } from '@/lib/numberAddOn';

// Customer-facing price copy for the public marketing pages, derived from src/lib/pricingTiers.ts so the wording cannot drift from
// the tiers. The pricing page and the dashboard tier picker read pricingTiers.ts directly; everything else (home page, compare pages,
// partner page, decks, llms.txt) uses these strings.
//
// Rules this file enforces:
//  - A tier that is not on sale yet is never advertised without saying it is coming soon (none today: all three tiers are live).
//  - Add-ons are not billable yet: copy says they are coming soon, with no amounts, until add-on billing exists. The one exception is
//    phone numbers, which are live: their prices come from src/lib/numberAddOn.ts (never typed here).
//  - Customer-facing prices only: no cost, margin or vendor-rate figures.

function tier(id: TierId) {
  const t = tierById(id);
  if (!t) throw new Error(`Unknown tier ${id}`);
  return t;
}

/** 5 -> "5¢". */
export function centsLabel(cents: number): string {
  return `${cents}¢`;
}

/** 5 -> "5 cents", 1 -> "1 cent". */
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

/** Must always accompany HEADLINE: says which tiers can be bought now (and which are still coming). */
export const QUALIFIER = (() => {
  const live = LIVE_TIERS.map((t) => `${t.name} ${centsWords(t.pricePerMinuteCents)}`);
  const joined = live.length > 1 ? `${live.slice(0, -1).join(', ')} and ${live[live.length - 1]}` : live.join('');
  if (COMING_SOON_TIERS.length === 0) return `${joined} per minute, all available now`;
  const soon = COMING_SOON_TIERS.map((t) => t.name).join(' and ');
  return `${soon} ${COMING_SOON_TIERS.length === 1 ? 'is' : 'are'} coming soon; ${joined} ${LIVE_TIERS.length === 1 ? 'is' : 'are'} available now`;
})();

/** One line for a "pricing" sentence on any public page. */
export const HEADLINE_WITH_QUALIFIER = `${HEADLINE}. ${QUALIFIER}.`;

export const CARRIER_NOTE_LINE = 'Every plan is bring-your-own carrier.';

export const ADD_ONS_LINE = 'Optional add-ons are coming soon and cannot be bought yet; amounts will be announced when they launch.';

/** Carrier explanation shared by compare copy. */
export const CARRIER_SHORT = 'bring your own carrier on every plan, or add phone numbers from us';

/** "Lite 2¢/min" plus " (coming soon)" only while a tier is not on sale. */
const soonSuffix = (id: TierId) => (tier(id).availability === 'coming_soon' ? ' (coming soon)' : '');

/** Comparison-table "us" cell, long form. */
export const US_RATE_LONG = `${centsLabel(tier('lite').pricePerMinuteCents)}/min Lite${soonSuffix('lite')}, ${centsLabel(tier('standard').pricePerMinuteCents)}/min Standard, or ${centsLabel(tier('pro').pricePerMinuteCents)}/min Pro; ${CARRIER_SHORT}`;

/** Comparison-table "us" cell, medium width. */
export const US_RATE_MEDIUM = `${centsLabel(tier('lite').pricePerMinuteCents)}/min Lite${soonSuffix('lite')}, ${centsLabel(tier('standard').pricePerMinuteCents)}/min Standard or ${centsLabel(tier('pro').pricePerMinuteCents)}/min Pro (your own carrier)`;

/** Comparison-table "us" cell, narrow (stat cards). */
export const US_RATE_SHORT = `${centsLabel(tier('lite').pricePerMinuteCents)} Lite${soonSuffix('lite')}, ${centsLabel(tier('standard').pricePerMinuteCents)} Standard, ${centsLabel(tier('pro').pricePerMinuteCents)} Pro`;

/** "2¢ to 9¢" range of what can be bought today. */
export const LIVE_RANGE = `${centsLabel(Math.min(...LIVE_TIERS.map((t) => t.pricePerMinuteCents)))} to ${centsLabel(Math.max(...LIVE_TIERS.map((t) => t.pricePerMinuteCents)))}`;

/** Same range in words, ASCII only, for the decks ("2 to 9 cents"). */
export const LIVE_RANGE_WORDS = `${Math.min(...LIVE_TIERS.map((t) => t.pricePerMinuteCents))} to ${Math.max(...LIVE_TIERS.map((t) => t.pricePerMinuteCents))} cents`;

/** What a 2-minute call costs at the live tiers, in dollars ("$0.04 to $0.18"). */
export function twoMinuteCallRange(): string {
  const cents = LIVE_TIERS.map((t) => t.pricePerMinuteCents * 2);
  const d = (c: number) => `$${(c / 100).toFixed(2)}`;
  return `${d(Math.min(...cents))} to ${d(Math.max(...cents))}`;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
function plainCents(c: number): string {
  return `${c}c`;
}
const CARRIER_NAMES: Record<NumberCarrier, string> = { telnyx: 'Telnyx', twilio: 'Twilio' };

/** One phone-number option, in the order shown: Telnyx (lower price) first, then Twilio (premium carrier). Prices read from numberAddOn.ts. */
export type PhoneNumberOption = { carrier: NumberCarrier; name: string; monthly: string; inbound: string; note: string; line: string };

export const PHONE_NUMBER_OPTIONS: PhoneNumberOption[] = [...NUMBER_CARRIERS].sort((a, b) => NUMBER_ADDON_PRICES[a].monthlyCents - NUMBER_ADDON_PRICES[b].monthlyCents).map((carrier) => {
  const p = NUMBER_ADDON_PRICES[carrier];
  const monthly = `${dollars(p.monthlyCents)} per month`;
  const inbound = `${centsWords(p.inboundCentsPerMinute)} per inbound minute`;
  const note = carrier === 'twilio' ? 'Premium carrier: supports payments and our existing SMS setup' : 'Lower-priced carrier';
  return { carrier, name: `${CARRIER_NAMES[carrier]} number`, monthly, inbound, note, line: `${CARRIER_NAMES[carrier]} number: ${monthly} + ${inbound}` };
});

export const BRING_YOUR_OWN_LINE = 'Bring your own number or carrier: free';

/** Phone numbers extra as one sentence, for plain-text surfaces. */
export const PHONE_NUMBERS_LINE = `Phone numbers from us, on any plan: ${PHONE_NUMBER_OPTIONS.map((o) => `${o.name}${o.carrier === 'twilio' ? ' (premium carrier: supports payments and our existing SMS setup)' : ''} ${o.monthly} plus ${o.inbound}`).join('; ')}. ${BRING_YOUR_OWN_LINE}.`;

/** Expert backup (src/lib/expertBackup.ts) is a live, priced extra on Lite and Standard; the amount comes from the constant, never typed here. */
export const EXPERT_BACKUP_LINE = `${EXPERT_BACKUP.label} on ${expertBackupAllowedTierNames()}: ${expertBackupPriceText().replace(/ per minute$/, '')} more per minute while it is on, for better accuracy on hard turns.`;

/** The worked example: computed from the tier price and the phone number constants so it cannot drift. */
export function workedExample(opts: { tier?: TierId; carrier?: NumberCarrier; inboundMinutes?: number } = {}): { text: string; totalCents: number } {
  const t = tier(opts.tier ?? 'standard');
  const carrier = opts.carrier ?? 'telnyx';
  const minutes = opts.inboundMinutes ?? 500;
  const p = NUMBER_ADDON_PRICES[carrier];
  const totalCents = Math.round(minutes * t.pricePerMinuteCents + p.monthlyCents + minutes * p.inboundCentsPerMinute);
  const text = `${t.name} with one ${CARRIER_NAMES[carrier]} number and ${minutes} inbound minutes a month: ${minutes} x ${plainCents(t.pricePerMinuteCents)} + ${dollars(p.monthlyCents)} + ${minutes} x ${plainCents(p.inboundCentsPerMinute)} = ${dollars(totalCents)}`;
  return { text, totalCents };
}

/** Plain-text pricing block for llms.txt and similar. */
export function pricingPlainText(): string {
  const lines = PRICING_TIERS.map((t) => {
    const status = t.availability === 'coming_soon' ? ' (coming soon, not available to buy yet)' : '';
    const r = ratingsForStack(t.stack);
    return `- ${t.name}: ${centsWords(t.pricePerMinuteCents)} per minute${status}. ${t.tagline} Voice: ${r.voice}. Response speed: ${r.responseSpeed}. Reasoning: ${r.reasoning}.`;
  });
  return [
    ...lines,
    `- Included on every plan: ${INCLUDED_ON_ALL.join('; ')}.`,
    `- ${HEADLINE_WITH_QUALIFIER}`,
    `- ${CARRIER_NOTE_LINE}`,
    `- ${PHONE_NUMBERS_LINE}`,
    `- ${EXPERT_BACKUP_LINE}`,
    `- ${workedExample().text}.`,
    `- ${ADD_ONS_LINE}`,
  ].join('\n');
}
