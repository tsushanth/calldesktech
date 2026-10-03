import { isTierId, tierById, type TierId } from '@/lib/pricingTiers';

// A plan picked on /pricing ("Start with Standard") is remembered in localStorage until the builder uses it. It only PRESELECTS a tier
// in the builder. It never accepts anything on the customer's behalf: Lite still needs its explicit voice-quality checkbox.
export const PLAN_STORAGE_KEY = 'calldesk_plan';

/** Validates untrusted input (query string, localStorage). Anything that is not exactly a tier id is ignored. */
export function parsePlan(raw: unknown): TierId | null {
  return isTierId(raw) ? raw : null;
}

/**
 * The tier the builder should start on for a NEW agent version. A tier already saved on the agent always wins; otherwise the stored
 * plan is used only when it is valid and on sale. Does not (and must not) decide whether the lower-quality acceptance is ticked.
 */
export function initialTierForBuilder(opts: { savedTier?: unknown; storedPlan?: unknown }): TierId | '' {
  const saved = parsePlan(opts.savedTier);
  if (saved) return saved;
  const plan = parsePlan(opts.storedPlan);
  if (!plan) return '';
  return tierById(plan)?.availability === 'live' ? plan : '';
}

export function readStoredPlan(): TierId | null {
  try { return parsePlan(window.localStorage.getItem(PLAN_STORAGE_KEY)); } catch { return null; }
}
export function storePlan(plan: TierId): void {
  try { window.localStorage.setItem(PLAN_STORAGE_KEY, plan); } catch { /* storage blocked: the plan can still be chosen in the builder */ }
}
export function clearStoredPlan(): void {
  try { window.localStorage.removeItem(PLAN_STORAGE_KEY); } catch { /* ignore */ }
}
