import type { TtsBackend } from '@/types';
import { PRICING } from '@/lib/constants';
import {
  ELEVEN_FLASH_TTS_MODEL,
  ELEVEN_V4_TURBO_TTS_MODEL,
  LITE_LLM_MODEL,
  PRO_LLM_MODEL,
  STANDARD_LLM_MODEL,
  validateModelChoice,
} from '@/lib/modelCatalog';

// The pricing tiers: the single source of truth for what a customer is sold. The API (GET /pricing, POST .../versions with `tier`),
// the MCP server, the docs, the pricing page and the dashboard tier picker all read this file.
//
// The tier is the engine and nothing else. A customer never has to know a model name or what a token is: each tier maps to a stack
// (language model + voice) that the engine uses, and choosing models directly stays an Advanced override for API and MCP users.
// Everything else (platform features, phone numbers, add-ons) is the same on every tier or a priced extra, never a reason to pick a tier.
// Every tier is bring-your-own carrier; phone numbers from us are a paid extra on every plan (src/lib/numberAddOn.ts).
//
// ADDITIVE, NOT A REPRICING. Agents that predate the tiers keep the flat per-minute price their voice backend has today
// ($0.10 default voice, $0.12 ElevenLabs/Cartesia, $0.16 MiniMax, all-in including phone numbers); see tierForLegacyConfig. Nothing in
// this file changes what any existing agent or subscription is billed. Billing by tier needs the metering work listed in
// docs/pricing-tier-migration-notes.md; until that ships the tier is recorded on the version but the subscription price is unchanged.
//
// Customer-facing prices only.

export type TierId = 'lite' | 'standard' | 'pro';
export type CarrierMode = 'byo' | 'managed';
export type TierAvailability = 'live' | 'coming_soon';
export const TIER_IDS: readonly TierId[] = ['lite', 'standard', 'pro'];

export type TierStack = {
  /** Language model id from src/lib/modelCatalog.ts. */
  llmModel: string;
  ttsBackend: TtsBackend;
  /** Voice model within ttsBackend, or null when the backend has no model choice. */
  ttsModel: string | null;
  /** Voice id the tier speaks with on its own backend (stamped on the version unless the caller sets voiceId). Piper voice ids are validated by the engine (piperVoices.js). */
  voiceId?: string;
  /** Internal reminder shown to engineers only; never sent to customers (see publicPricing). */
  ttsPromoNote?: string;
};

export type PricingTier = {
  id: TierId;
  name: string;
  pricePerMinuteCents: number;
  /** One line on the engine this tier runs. */
  tagline: string;
  whoItsFor: string;
  carrierMode: CarrierMode;
  availability: TierAvailability;
  stack: TierStack;
  /** The voice is our efficient one, less expressive than Standard's. Choosing this tier must be a conscious, explicit decision (publish needs acceptLowerQuality: true). */
  lowerQuality?: boolean;
};

/** Short text labels a customer can compare at a glance. No numbers and no benchmark claims. */
export type TierRatings = { voice: string; responseSpeed: string; reasoning: string };

// Labels derived from a tier's stack (never typed per tier), so changing a stack forces a conscious change here. Keyed by the ids in
// src/lib/modelCatalog.ts; test/lib/pricingTiers.test.ts fails if a tier's stack has no entry.
const VOICE_LABELS: Record<string, string> = {
  'piper:': 'Clear and efficient',
  [`elevenlabs:${ELEVEN_FLASH_TTS_MODEL}`]: 'Natural',
  [`elevenlabs:${ELEVEN_V4_TURBO_TTS_MODEL}`]: 'Most expressive',
};
const LLM_LABELS: Record<string, { responseSpeed: string; reasoning: string }> = {
  [LITE_LLM_MODEL]: { responseSpeed: 'Good', reasoning: 'Good' },
  [STANDARD_LLM_MODEL]: { responseSpeed: 'Fast', reasoning: 'Strong' },
  [PRO_LLM_MODEL]: { responseSpeed: 'Fast', reasoning: 'Strongest' },
};

/** Voice / Response speed / Reasoning for a tier, from its stack. Throws when the stack has no label (caught by tests). */
export function ratingsForStack(stack: TierStack): TierRatings {
  const voice = VOICE_LABELS[`${stack.ttsBackend}:${stack.ttsModel ?? ''}`];
  const llm = LLM_LABELS[stack.llmModel];
  if (!voice || !llm) throw new Error(`No customer-facing labels for stack ${stack.llmModel} / ${stack.ttsBackend}:${stack.ttsModel ?? ''}`);
  return { voice, ...llm };
}

export type AddOnId = 'sentiment_per_turn' | 'advanced_analytics' | 'premium_voice' | 'long_prompts';

export type AddOn = {
  id: AddOnId;
  label: string;
  description: string;
  /** Extra cents per minute, or null until the owner sets the amount. */
  centsPerMinute: number | null;
  /** Every add-on is a proposal: amounts and scope are placeholders the owner will set. */
  proposed: true;
  defaultOn: boolean;
};

/** The platform features every plan has. Stated once on every page (never per tier); each is backed by code (dashboard, API or MCP). */
export const INCLUDED_ON_ALL = [
  'Call summary',
  'Full transcript',
  'Structured field extraction (name, reason for the call, and anything else you ask for)',
  'Call transfers',
  'Keypad tones (DTMF)',
  'Knowledge base',
  'Calendar booking',
  'Call testing and live call monitoring',
  'API and MCP server',
  "40+ languages (non-English languages need the Standard or Pro voice; Lite's voice is English only)",
];

export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'lite',
    name: 'Lite',
    pricePerMinuteCents: 2,
    tagline: 'An efficient engine with a clear, English-only voice.',
    whoItsFor: 'Straightforward calls such as confirmations and quick questions, where cost matters most.',
    carrierMode: 'byo',
    availability: 'live',
    // The Kokoro-distilled voice (owner-accepted provenance, 2026-10-03): explicit so Lite never falls back to the engine's global Piper default.
    stack: { llmModel: LITE_LLM_MODEL, ttsBackend: 'piper', ttsModel: null, voiceId: 'custom:en-us-warm-f' },
    lowerQuality: true,
  },
  {
    id: 'standard',
    name: 'Standard',
    pricePerMinuteCents: 5,
    tagline: 'A fast, strong engine with a natural voice.',
    whoItsFor: 'Most businesses: reception, booking, intake and after-hours coverage.',
    carrierMode: 'byo',
    availability: 'live',
    stack: { llmModel: STANDARD_LLM_MODEL, ttsBackend: 'elevenlabs', ttsModel: ELEVEN_FLASH_TTS_MODEL },
  },
  {
    id: 'pro',
    name: 'Pro',
    pricePerMinuteCents: 9,
    tagline: 'Our strongest engine with our most expressive voice.',
    whoItsFor: 'Complex or high-stakes calls where reasoning and tone matter most.',
    carrierMode: 'byo',
    availability: 'live',
    stack: {
      llmModel: PRO_LLM_MODEL,
      ttsBackend: 'elevenlabs',
      ttsModel: ELEVEN_V4_TURBO_TTS_MODEL,
      ttsPromoNote: 'Re-check this voice choice when the provider’s introductory period ends on 2026-10-12.',
    },
  },
];

export const ADD_ONS: AddOn[] = [
  { id: 'sentiment_per_turn', label: 'Caller sentiment, every turn', description: 'Reads the caller’s mood after every turn so you can see where calls go wrong. Off unless you turn it on.', centsPerMinute: null, proposed: true, defaultOn: false },
  { id: 'advanced_analytics', label: 'Advanced analytics', description: 'Deeper reporting on outcomes, topics and trends across your calls.', centsPerMinute: null, proposed: true, defaultOn: false },
  { id: 'premium_voice', label: 'Premium voice', description: 'Step up to a more expressive voice on a tier that does not include one.', centsPerMinute: null, proposed: true, defaultOn: false },
  { id: 'long_prompts', label: 'Long prompts', description: 'Room for very long instructions and reference text in one agent.', centsPerMinute: null, proposed: true, defaultOn: false },
];

// Phone numbers are a live, priced extra on every plan; their amounts live in src/lib/numberAddOn.ts and are shown by src/lib/pricingCopy.ts
// (not imported here to avoid a cycle).
export const CARRIER_NOTE = 'Bring your own carrier on every plan, or add phone numbers from us.';

export function tierById(id: unknown): PricingTier | undefined {
  return typeof id === 'string' ? PRICING_TIERS.find((t) => t.id === id) : undefined;
}

export function isTierId(id: unknown): id is TierId {
  return typeof id === 'string' && (TIER_IDS as readonly string[]).includes(id);
}

export function addOnById(id: unknown): AddOn | undefined {
  return typeof id === 'string' ? ADD_ONS.find((a) => a.id === id) : undefined;
}

function dollars(cents: number): string {
  const d = cents / 100;
  // Whole-cent amounts read as $0.05; sub-cent placeholders keep their precision.
  return `$${Number.isInteger(cents) ? d.toFixed(2) : String(d)}`;
}

export type PriceQuote = {
  tier: TierId;
  /** Tier price plus every add-on that has a price set. */
  centsPerMinute: number;
  /** Selected add-ons whose amount the owner has not set yet (counted as 0 in centsPerMinute). */
  unpricedAddOns: AddOnId[];
  purchasable: boolean;
  explanation: string;
};

/** Price per minute for a tier plus chosen add-ons, with a one-line explanation a customer can read. Throws on an unknown tier or add-on. */
export function priceFor(opts: { tier: TierId | string; addOns?: Array<AddOnId | string> }): PriceQuote {
  const tier = tierById(opts.tier);
  if (!tier) throw new Error(`Unknown tier "${String(opts.tier)}". Valid: ${TIER_IDS.join(', ')}`);
  const selected: AddOn[] = [];
  for (const id of new Set(opts.addOns ?? [])) {
    const a = addOnById(id);
    if (!a) throw new Error(`Unknown add-on "${String(id)}". Valid: ${ADD_ONS.map((x) => x.id).join(', ')}`);
    selected.push(a);
  }
  const priced = selected.filter((a) => a.centsPerMinute !== null);
  const unpriced = selected.filter((a) => a.centsPerMinute === null);
  const total = tier.pricePerMinuteCents + priced.reduce((sum, a) => sum + (a.centsPerMinute as number), 0);

  const parts = [`${tier.name} is ${dollars(tier.pricePerMinuteCents)} per minute`];
  if (priced.length) parts.push(`plus ${priced.map((a) => `${a.label} ${dollars(a.centsPerMinute as number)}`).join(', ')}`);
  let explanation = parts.join(' ') + (priced.length ? `, ${dollars(total)} per minute in all` : '');
  explanation += tier.carrierMode === 'byo' ? ' (phone carrier billed separately).' : ' (carrier included in the rate).';
  if (unpriced.length) explanation += ` ${unpriced.map((a) => a.label).join(', ')}: price to be announced.`;
  if (tier.availability === 'coming_soon') explanation += ' Coming soon.';

  return { tier: tier.id, centsPerMinute: total, unpricedAddOns: unpriced.map((a) => a.id), purchasable: tier.availability === 'live', explanation };
}

/** The models and voice the engine should use for a tier. A copy, so callers cannot mutate the catalog. */
export function stackForTier(tier: TierId | string): TierStack {
  const t = tierById(tier);
  if (!t) throw new Error(`Unknown tier "${String(tier)}". Valid: ${TIER_IDS.join(', ')}`);
  return { ...t.stack };
}

export type LegacyPlan = {
  legacy: true;
  /** The price this agent is billed today, in cents per minute, all-in including phone service. Never changed by the tiers. */
  centsPerMinute: number;
  /** A tier that costs the same and covers the same things, or null when none does (always null today: no tier includes phone numbers). Informational only. */
  equivalentTier: TierId | null;
  label: string;
  explanation: string;
};

/**
 * What an agent that predates the tiers pays: the flat per-minute price of its voice backend (the same numbers as PRICING in
 * src/lib/constants.ts, the figures on the existing pricing page). Existing agents stay on this price; the tier layer never reprices them.
 * No tier matches a legacy price: every tier is bring-your-own carrier, while the legacy flat price includes phone numbers.
 * Pass the version's tts_backend (null or undefined means the default voice).
 */
export function tierForLegacyConfig(ttsBackend?: TtsBackend | string | null): LegacyPlan {
  const rates = PRICING.usage.voicePerMinute as Record<string, number>;
  const backend = ttsBackend && ttsBackend in rates ? ttsBackend : 'piper';
  const centsPerMinute = Math.round(rates[backend] * 100);
  return {
    legacy: true,
    centsPerMinute,
    equivalentTier: null,
    label: backend === 'kokoro' || backend === 'piper' ? 'Current flat price (default voice)' : 'Current flat price (premium voice)',
    explanation: `Existing agents keep their current price: ${dollars(centsPerMinute)} per minute, all-in with phone numbers built in. Choosing a tier is optional.`,
  };
}

export type TierPublishInput = {
  tier?: unknown;
  voiceEngine?: string;
  llmModel?: string | null;
  ttsModel?: string | null;
  ttsBackend?: TtsBackend | null;
  /** The customer has acknowledged the voice-quality tradeoff of a lowerQuality tier. */
  acceptLowerQuality?: boolean;
};

export type TierPublishResult =
  | { ok: true; tier: TierId | null; llmModel: string | undefined; ttsModel: string | undefined; ttsBackend: TtsBackend | undefined; voiceId?: string; overrides: Array<'llmModel' | 'ttsBackend' | 'ttsModel'> }
  | { ok: false; error: string };

/**
 * Applies a publish-version request's optional `tier`: validates it, rejects a tier that is not on sale yet, and fills in the models the
 * engine should use from the tier's stack. Models the caller set explicitly win (and are listed in `overrides`). With no tier the
 * request passes through untouched, so legacy behaviour is unchanged. The result is not yet checked against the model catalog; the
 * route still runs validateModelChoice on it.
 */
export function resolveTierForPublish(input: TierPublishInput): TierPublishResult {
  const { tier: rawTier, voiceEngine } = input;
  const passthrough = { llmModel: input.llmModel || undefined, ttsModel: input.ttsModel || undefined, ttsBackend: input.ttsBackend || undefined, overrides: [] as never[] };
  if (rawTier === undefined || rawTier === null) return { ok: true, tier: null, ...passthrough };
  const tier = tierById(rawTier);
  if (!tier) return { ok: false, error: `Unknown tier "${String(rawTier)}". Valid: ${TIER_IDS.join(', ')}` };
  if (tier.availability !== 'live') return { ok: false, error: `The ${tier.name} tier is coming soon and cannot be selected yet. Choose ${PRICING_TIERS.filter((t) => t.availability === 'live').map((t) => t.id).join(' or ')}.` };
  if (voiceEngine !== 'poc') return { ok: false, error: 'tier applies only to agents on the in-house voice engine (voiceEngine "poc")' };
  if (tier.lowerQuality && input.acceptLowerQuality !== true) {
    return { ok: false, error: `The ${tier.name} tier uses our efficient voice, which is less expressive than the Standard voice. Pass acceptLowerQuality: true to confirm you are choosing it for the lower price, or choose Standard.`, };
  }

  const stack = tier.stack;
  const overrides: Array<'llmModel' | 'ttsBackend' | 'ttsModel'> = [];
  const llmModel = input.llmModel || stack.llmModel;
  if (input.llmModel && input.llmModel !== stack.llmModel) overrides.push('llmModel');
  const ttsBackend = input.ttsBackend || stack.ttsBackend;
  if (input.ttsBackend && input.ttsBackend !== stack.ttsBackend) overrides.push('ttsBackend');
  // The tier's voice model only makes sense on the tier's own backend; on another backend the engine default applies.
  const ttsModel = input.ttsModel || (ttsBackend === stack.ttsBackend ? stack.ttsModel || undefined : undefined);
  if (input.ttsModel && input.ttsModel !== stack.ttsModel) overrides.push('ttsModel');
  // The tier's voice only applies on the tier's own backend; an overridden backend picks its own voice.
  const voiceId = ttsBackend === stack.ttsBackend ? stack.voiceId : undefined;
  return { ok: true, tier: tier.id, llmModel, ttsModel, ttsBackend, voiceId, overrides };
}

/** Sanity check used by tests: every tier stack is accepted by the model catalog's own validation. */
export function stackErrors(): string[] {
  const errs: string[] = [];
  for (const t of PRICING_TIERS) {
    const e = validateModelChoice({ voiceEngine: 'poc', llmModel: t.stack.llmModel, ttsModel: t.stack.ttsModel, ttsBackend: t.stack.ttsBackend });
    if (e) errs.push(`${t.id}: ${e}`);
  }
  return errs;
}

/**
 * What the public API and pages show. The engine stack (model ids) is left out on purpose: customers choose a tier, not models,
 * and the stack can change without anyone's price or promise changing.
 */
export function publicPricing() {
  return {
    currency: 'USD',
    unit: 'per minute of call time',
    tiers: PRICING_TIERS.map(({ stack, ...t }) => ({ ...t, ratings: ratingsForStack(stack), pricePerMinuteDollars: t.pricePerMinuteCents / 100 })),
    addOns: ADD_ONS,
    includedOnAllTiers: INCLUDED_ON_ALL,
    carrierNote: CARRIER_NOTE,
    notes: [
      'Phone numbers are a paid extra on every plan; bringing your own number or carrier is free. See phoneNumbers for the prices.',
      'Add-ons are coming soon and cannot be bought yet; amounts will be announced when they launch. Nothing is billed for them.',
      'Agents created before pricing tiers keep their current per-minute price. Choosing a tier is optional.',
    ],
  };
}
