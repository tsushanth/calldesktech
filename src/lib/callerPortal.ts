import { createHash, randomBytes } from 'node:crypto';
import { normalizeNanp } from '@/lib/outboundCalling';

// The eight things a caller can record for a number, in the order they appear in the script.
export const OUTCOMES = [
  'no_answer',
  'voicemail',
  'gatekeeper',
  'callback_requested',
  'forward_number_requested',
  'not_interested',
  'wrong_number',
  'do_not_call',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  no_answer: 'No answer',
  voicemail: 'Voicemail',
  gatekeeper: 'Gatekeeper',
  callback_requested: 'Callback requested',
  forward_number_requested: 'Forward-number requested',
  not_interested: 'Not interested',
  wrong_number: 'Wrong number',
  do_not_call: 'Do not call',
};

// Why a person said no. Required when a caller logs "Not interested", so the pitch can be changed on evidence instead of guesses.
// Stored at the start of the notes as "[reason:<code>] free text" (no schema change); declineReasonOf() reads it back.
export const DECLINE_REASONS = [
  'covered_24_7',
  'has_staff',
  'not_decision_maker',
  'dont_trust_unknown_caller',
  'no_interest_in_ai',
  'bad_timing',
  'price',
  'other',
] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];
export const DECLINE_REASON_LABELS: Record<DeclineReason, string> = {
  covered_24_7: 'Already covered (answer 24/7)',
  has_staff: 'Has staff / dispatch team for calls',
  not_decision_maker: 'Not the decision maker',
  dont_trust_unknown_caller: 'Did not trust / wanted to know who we are',
  no_interest_in_ai: 'Does not want an AI on the phone',
  bad_timing: 'Bad timing / too busy',
  price: 'Price / budget',
  other: 'Other (say what in notes)',
};
export function isDeclineReason(v: unknown): v is DeclineReason {
  return typeof v === 'string' && (DECLINE_REASONS as readonly string[]).includes(v);
}
// Tags stored at the start of the notes, in this order: "[dm:yes|no][reason:<code>] free text" (no schema change).
const TAGS_RE = /^((?:\[(?:dm|reason):[a-z0-9_]+\]\s*)*)/;
export function declineReasonOf(notes: string | null | undefined): DeclineReason | null {
  const m = /\[reason:([a-z0-9_]+)\]/.exec((TAGS_RE.exec(notes ?? '') ?? [''])[0]);
  return m && isDeclineReason(m[1]) ? m[1] : null;
}
/** The caller's answer to "Did you reach the owner / decision maker?", or null when not recorded (older rows, or outcomes that do not ask). */
export function decisionMakerOf(notes: string | null | undefined): boolean | null {
  const m = /\[dm:(yes|no)\]/.exec((TAGS_RE.exec(notes ?? '') ?? [''])[0]);
  return m ? m[1] === 'yes' : null;
}
export function stripReason(notes: string | null | undefined): string {
  return (notes ?? '').replace(TAGS_RE, '').trim();
}
export function withTags(tags: { dm?: boolean | null; reason?: DeclineReason | null }, text: string | null | undefined): string | null {
  const body = stripReason(text);
  const prefix = `${tags.dm === true ? '[dm:yes]' : tags.dm === false ? '[dm:no]' : ''}${tags.reason ? `[reason:${tags.reason}]` : ''}`;
  const out = `${prefix}${prefix && body ? ' ' : ''}${body}`.slice(0, 1000);
  return out || null;
}

// A person (not a machine or an empty line) spoke to the caller on these outcomes, so the caller must say whether that person was the owner or
// decision maker. The answer is how we measure whether asking for the owner by name works.
export const OUTCOMES_ASKING_DECISION_MAKER: Outcome[] = ['gatekeeper', 'callback_requested', 'forward_number_requested', 'not_interested', 'do_not_call'];

// The script's two kinds of win: a yes to the text with the forwarding number, or a specific callback time.
export const WIN_OUTCOMES: Outcome[] = ['forward_number_requested', 'callback_requested'];

export function isOutcome(v: unknown): v is Outcome {
  return typeof v === 'string' && (OUTCOMES as readonly string[]).includes(v);
}

// Links are random and unguessable; only the hash is stored.
export function generateToken(): string {
  return randomBytes(24).toString('base64url');
}
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface OutcomeInput {
  outcome?: unknown;
  notes?: unknown;
  mobile_number?: unknown;
  text_ok?: unknown;
  reason?: unknown;
  decision_maker?: unknown;
}
export type OutcomeResult =
  | { ok: true; value: { outcome: Outcome; notes: string | null; mobile_number: string | null; text_ok: boolean } }
  | { ok: false; error: string };

export function validateOutcomeInput(i: OutcomeInput): OutcomeResult {
  if (!isOutcome(i.outcome)) return { ok: false, error: 'Pick one of the outcomes.' };
  const outcome = i.outcome;
  const notes = typeof i.notes === 'string' ? i.notes.trim().slice(0, 1000) : '';
  let dm: boolean | null = null;
  if (OUTCOMES_ASKING_DECISION_MAKER.includes(outcome)) {
    if (i.decision_maker !== true && i.decision_maker !== false) return { ok: false, error: 'Answer: did you reach the owner or decision maker? (Yes or No)' };
    dm = i.decision_maker;
  }
  if (outcome === 'forward_number_requested') {
    const mobile = typeof i.mobile_number === 'string' ? normalizeNanp(i.mobile_number) : null;
    if (!mobile) return { ok: false, error: 'Enter the mobile number to text (10 digits).' };
    if (i.text_ok !== true) return { ok: false, error: 'Tick the box to confirm they agreed to a text.' };
    return { ok: true, value: { outcome, notes: withTags({ dm }, notes), mobile_number: mobile, text_ok: true } };
  }
  if (outcome === 'not_interested') {
    if (!isDeclineReason(i.reason)) return { ok: false, error: 'Pick why they said no (it takes one tap and it is how we fix the pitch).' };
    if (i.reason === 'other' && !stripReason(notes)) return { ok: false, error: 'You picked "Other": write what they said in the notes.' };
    return { ok: true, value: { outcome, notes: withTags({ dm, reason: i.reason }, notes), mobile_number: null, text_ok: false } };
  }
  if (outcome === 'callback_requested' && !stripReason(notes)) {
    return { ok: false, error: 'Write the callback time in the notes.' };
  }
  return { ok: true, value: { outcome, notes: withTags({ dm }, notes), mobile_number: null, text_ok: false } };
}
