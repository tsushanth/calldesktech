import type { TierId } from '@/lib/pricingTiers';
import { isTierId } from '@/lib/pricingTiers';

// Expert backup: a paid extra that can be switched on per agent version. The version's normal tier model answers; when it is unsure
// (a correction, an off-topic question, anything it would otherwise guess) the turn is handed to a stronger model (Claude Sonnet), which
// improves accuracy on those turns at a small latency cost. Offered on Lite and Standard only: Pro already runs the strongest model.
//
// The price is ONE constant. Every page, API description, the builder toggle, the terms text and the billing code derive from it; the
// metered Stripe price (STRIPE_PRICE_EXPERT_BACKUP) is created to match and reported in whole call-seconds (see docs/tiered-billing.md).
//
// Customer-facing prices only.

/** Extra cents per minute while the mode is on (billed per call-second on its own meter, on top of the tier price). */
export const EXPERT_BACKUP_CENTS_PER_MINUTE: number = 1.5;

/** The only stored value of calldesk_agent_versions.routing_mode / calldesk_call_logs.routing_mode (null = standard routing). */
export const EXPERT_BACKUP_ROUTING_MODE = 'expert_backup';
export type RoutingMode = typeof EXPERT_BACKUP_ROUTING_MODE;

/** Stripe meter event name for expert backup seconds (unit seconds, aggregation sum, customer mapped by stripe_customer_id, value key `value`). */
export const EXPERT_BACKUP_METER_EVENT = 'calldesktech_expert_backup_seconds';

/** Env var holding the metered Stripe price id (0.025 cents per second on the meter above). Unset or blank = the feature cannot be sold. */
export const EXPERT_BACKUP_PRICE_ENV = 'STRIPE_PRICE_EXPERT_BACKUP';

export const EXPERT_BACKUP = {
  id: EXPERT_BACKUP_ROUTING_MODE,
  label: 'Expert backup',
  description: 'Your agent answers as usual and hands the hard turns (corrections, off-topic questions, anything it would otherwise guess) to a stronger model for better accuracy on hard turns.',
  /** Pro already runs our strongest model, so it is not offered there. */
  allowedTiers: ['lite', 'standard'] as readonly TierId[],
  centsPerMinute: EXPERT_BACKUP_CENTS_PER_MINUTE,
  /** The stronger model the engine escalates to. Internal: public pages and API output say "a stronger model" and never name a model (see test/lib/tierRestructure.test.ts). */
  expertModel: 'Claude Sonnet',
} as const;

/** "1.5" or "2": the shortest exact decimal of a cents amount. */
function trimCents(c: number): string {
  return String(Number(c.toFixed(4)));
}

/** "+1.5¢ per minute". */
export function expertBackupPriceShort(): string {
  return `+${trimCents(EXPERT_BACKUP_CENTS_PER_MINUTE)}¢ per minute`;
}

/** "1.5 cents per minute" (ASCII, for API text and error messages). */
export function expertBackupPriceText(): string {
  const c = EXPERT_BACKUP_CENTS_PER_MINUTE;
  return `${trimCents(c)} cent${c === 1 ? '' : 's'} per minute`;
}

/** Builder toggle label: "Expert backup, +1.5¢ per minute". */
export function expertBackupToggleLabel(): string {
  return `${EXPERT_BACKUP.label}, ${expertBackupPriceShort()}`;
}

/** The sentence a customer accepts. Shown in the builder, and returned with the 400 when acceptExpertBackup is missing. */
export function expertBackupTerms(): string {
  return `Expert backup adds ${expertBackupPriceText()} to your plan's per-minute price for every call on this version. Your agent's normal model answers, and turns it is unsure about are handed to a stronger model for better accuracy on hard turns, with a small added delay on those turns. It is available on ${expertBackupAllowedTierNames()} and can be turned off by publishing a new version without it.`;
}

export function expertBackupAllowedTierNames(): string {
  return EXPERT_BACKUP.allowedTiers.map((t) => t[0].toUpperCase() + t.slice(1)).join(' and ');
}

export function isRoutingMode(v: unknown): v is RoutingMode {
  return v === EXPERT_BACKUP_ROUTING_MODE;
}

/** True when the mode may be sold on this tier (Lite and Standard). */
export function expertBackupAllowedOnTier(tier: unknown): tier is TierId {
  return isTierId(tier) && (EXPERT_BACKUP.allowedTiers as readonly string[]).includes(tier);
}

/** The Stripe price id for the metered expert backup line, or null when the env var is unset or blank (fail closed: no free expert backup). */
export function expertBackupPriceId(): string | null {
  const v = process.env[EXPERT_BACKUP_PRICE_ENV]?.trim();
  return v ? v : null;
}

export function expertBackupBillingConfigured(): boolean {
  return expertBackupPriceId() !== null;
}

/** Thrown when expert backup billing is attempted while STRIPE_PRICE_EXPERT_BACKUP is unset. */
export class ExpertBackupNotConfiguredError extends Error {
  constructor() {
    super('Expert backup is not available yet: billing is not configured.');
    this.name = 'ExpertBackupNotConfiguredError';
  }
}

export type ExpertBackupPublishInput = {
  routingMode?: unknown;
  acceptExpertBackup?: unknown;
  voiceEngine?: string;
  /** The resolved tier (after resolveTierForPublish), or null for an untiered publish. */
  tier: TierId | null;
};

export type ExpertBackupPublishResult =
  | { ok: true; routingMode: RoutingMode | null }
  | { ok: false; status: 400; code: string; error: string; terms?: string };

/** Validates a publish request's optional routingMode. Absent or null = standard routing (ok, null). */
export function resolveExpertBackupForPublish(input: ExpertBackupPublishInput): ExpertBackupPublishResult {
  const { routingMode } = input;
  if (routingMode === undefined || routingMode === null) return { ok: true, routingMode: null };
  if (!isRoutingMode(routingMode)) {
    return { ok: false, status: 400, code: 'invalid_routing_mode', error: `Unknown routingMode "${String(routingMode)}". Valid: ${EXPERT_BACKUP_ROUTING_MODE}, or omit it for standard routing.` };
  }
  if (input.voiceEngine !== 'poc') {
    return { ok: false, status: 400, code: 'expert_backup_needs_poc_engine', error: 'routingMode applies only to agents on the in-house voice engine (voiceEngine "poc").' };
  }
  if (!expertBackupAllowedOnTier(input.tier)) {
    return {
      ok: false,
      status: 400,
      code: 'expert_backup_tier_not_allowed',
      error: `Expert backup is available on ${expertBackupAllowedTierNames()} only. ${input.tier === 'pro' ? 'Pro already runs our strongest model.' : 'Publish with tier "lite" or "standard" to use it.'}`,
    };
  }
  if (input.acceptExpertBackup !== true) {
    const terms = expertBackupTerms();
    return { ok: false, status: 400, code: 'expert_backup_acceptance_required', error: `${terms} Pass acceptExpertBackup: true to confirm.`, terms };
  }
  return { ok: true, routingMode: EXPERT_BACKUP_ROUTING_MODE };
}

/** What the public API and pages show about the extra. */
export function publicExpertBackup() {
  return {
    id: EXPERT_BACKUP.id,
    label: EXPERT_BACKUP.label,
    description: EXPERT_BACKUP.description,
    availability: 'live' as const,
    tiers: [...EXPERT_BACKUP.allowedTiers],
    centsPerMinute: EXPERT_BACKUP.centsPerMinute,
    publishFields: { routingMode: EXPERT_BACKUP_ROUTING_MODE, acceptExpertBackup: true },
    terms: expertBackupTerms(),
  };
}
