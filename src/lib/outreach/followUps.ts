import { isFreightProduct } from './freight';

// Pure rules for the follow-up stage (pipeline.ts stageFollowUp) and its autosend cap. No I/O.
//
// Cadence (days since the FIRST email was sent): step 2 at day 4, step 3 at day 9 (the final,
// close-the-loop touch). With OUTREACH_FOLLOWUP_DELAY_DAYS = d the schedule is d, d+5, d+10, ...
// A follow-up also never goes out less than MIN_GAP_DAYS after the previous touch, so a late step 2 does not
// pull step 3 right behind it.

export const DEFAULT_FOLLOWUP_DELAY_DAYS = 4;
const STEP_SPACING_DAYS = 5;
export const MIN_GAP_DAYS = 2;
const DAY_MS = 86_400_000;

export function followUpDelayDays(raw: string | undefined = process.env.OUTREACH_FOLLOWUP_DELAY_DAYS): number {
  return Math.max(1, Number(raw) || DEFAULT_FOLLOWUP_DELAY_DAYS);
}

/** Cumulative days after the first email at which touch `step` (2, 3, ...) is due. */
export function followUpDueDay(step: number, delayDays = followUpDelayDays()): number {
  return delayDays + STEP_SPACING_DAYS * Math.max(0, step - 2);
}

export interface TouchTimes { firstSentAt: string | null; latestSentAt: string | null }

/** Is touch `nextStep` due at `now`, given when the first and the latest touches were sent? */
export function isFollowUpDue(nextStep: number, t: TouchTimes, now: Date, delayDays = followUpDelayDays()): boolean {
  if (!t.firstSentAt || !t.latestSentAt || nextStep < 2) return false;
  const first = Date.parse(t.firstSentAt);
  const latest = Date.parse(t.latestSentAt);
  if (!Number.isFinite(first) || !Number.isFinite(latest)) return false;
  const nowMs = now.getTime();
  return nowMs >= first + followUpDueDay(nextStep, delayDays) * DAY_MS && nowMs >= latest + MIN_GAP_DAYS * DAY_MS;
}

/**
 * Follow-ups are generated AND auto-approved (they then go out through autosend's normal pacing, caps and
 * health checks) unless OUTREACH_FOLLOWUP_AUTOAPPROVE=0. Scope: the products listed in
 * OUTREACH_FOLLOWUP_AUTOAPPROVE_PRODUCTS (comma list of vertical ids, '*' = all), default 'freight' only, so
 * no other vertical changes behavior. Anything not auto-approved is left as a draft for manual review, as before.
 */
export function followUpAutoApprove(productId: string, env: Record<string, string | undefined> = process.env): boolean {
  if ((env.OUTREACH_FOLLOWUP_AUTOAPPROVE ?? '').trim() === '0') return false;
  const list = (env.OUTREACH_FOLLOWUP_AUTOAPPROVE_PRODUCTS ?? 'freight').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes('*') || list.includes(productId.toLowerCase());
}

/**
 * Max follow-ups (step > 1) autosend may send per lane per day. Default: half the lane's daily send cap, so
 * first touches always keep at least half of it and follow-ups are guaranteed priority up to this number.
 * OUTREACH_FOLLOWUP_DAILY_CAP overrides (0 = autosend sends no follow-ups); invalid values use the default.
 */
export function followUpDailyCap(laneCap: number, raw: string | undefined = process.env.OUTREACH_FOLLOWUP_DAILY_CAP): number {
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.min(500, Math.floor(n));
  return Math.ceil(Math.max(0, laneCap) / 2);
}

/** Max follow-ups drafted per discovery run (each is one LLM call). */
export function followUpPerRunCap(raw: string | undefined = process.env.OUTREACH_FOLLOWUP_MAX_PER_RUN): number {
  const n = Number(raw);
  return Math.min(100, Math.max(1, Number.isFinite(n) && n > 0 ? Math.floor(n) : 30));
}

const WRONG_DURATION = /\b(two|2)[- ]weeks?\b|\b14[- ]days?\b|\b(three|3)[- ]weeks?\b/i;
const MONEY = /\$\s?\d|\bper minute\b|\bdiscount\b|\brevenue share\b/i;
const LINK = /https?:\/\/|www\./i;
const DEMO_ARM_FORBIDDEN = /\bpilot\b|\bfree trial\b|\bfree for\b|\b50 minutes\b|\bforward(ing)? (your )?calls\b/i;

/**
 * Last gate before a follow-up is auto-approved. Returns a reason when the body must go to manual review
 * instead (the model drifted from the offer facts). Only freight has guardrails today; other products are
 * not auto-approved at all unless an operator opts them in, and then get the generic checks only.
 */
export function followUpDraftProblem(productId: string, arm: string | null | undefined, body: string): string | null {
  if (LINK.test(body)) return 'contains a link';
  if (MONEY.test(body)) return 'states a price or money term';
  if (isFreightProduct(productId)) {
    if (WRONG_DURATION.test(body)) return 'states a pilot length other than one week';
    if (arm === 'demo' && DEMO_ARM_FORBIDDEN.test(body)) return 'demo arm mentions the pilot or trial';
  }
  return null;
}
