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
}
export type OutcomeResult =
  | { ok: true; value: { outcome: Outcome; notes: string | null; mobile_number: string | null; text_ok: boolean } }
  | { ok: false; error: string };

export function validateOutcomeInput(i: OutcomeInput): OutcomeResult {
  if (!isOutcome(i.outcome)) return { ok: false, error: 'Pick one of the outcomes.' };
  const notes = typeof i.notes === 'string' ? i.notes.trim().slice(0, 1000) : '';
  if (i.outcome === 'forward_number_requested') {
    const mobile = typeof i.mobile_number === 'string' ? normalizeNanp(i.mobile_number) : null;
    if (!mobile) return { ok: false, error: 'Enter the mobile number to text (10 digits).' };
    if (i.text_ok !== true) return { ok: false, error: 'Tick the box to confirm they agreed to a text.' };
    return { ok: true, value: { outcome: i.outcome, notes: notes || null, mobile_number: mobile, text_ok: true } };
  }
  if (i.outcome === 'callback_requested' && !notes) {
    return { ok: false, error: 'Write the callback time in the notes.' };
  }
  return { ok: true, value: { outcome: i.outcome, notes: notes || null, mobile_number: null, text_ok: false } };
}
