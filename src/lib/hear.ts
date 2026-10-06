import { createHash } from 'node:crypto';
import { normalizeNanp } from '@/lib/outboundCalling';
import { stateFromPhone } from '@/lib/areaCodeState';
import { checkCallingHours } from '@/lib/callingHours';

// The public "hear it" demo call (/hear): a visitor types their own US number, ticks the box, and we place one demo call.
// Pure decisions live here so they can be tested; the route does the I/O.

export const HEAR_CONSENT_VERSION = 'hear-2026-10-06';
export const HEAR_CONSENT_TEXT =
  'I agree that Calldesk may place one call to the number I entered, using an AI-generated voice, so I can hear a demo. ' +
  'The call may be recorded and transcribed for quality. I am not required to agree in order to buy anything, and I can say stop ' +
  'on the call or email support@calldesk.tech at any time to be removed.';
export const hearConsentSha256 = () => createHash('sha256').update(HEAR_CONSENT_TEXT).digest('hex');

export const HEAR_LIMITS = { perPhonePerDay: 1, perIpPerDay: 3, globalPerDay: 100 };

/** Business name goes into the demo agent's prompt, so keep it to a short plain string. */
export function cleanBusinessName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[^\p{L}\p{N} &'.,-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s.length >= 2 ? s : null;
}

export type HearInput = {
  phone: unknown; consent: unknown; website?: unknown; businessName?: unknown; shownVersion?: unknown; shownSha256?: unknown;
};
export type HearParsed =
  | { ok: true; phone: string; state: string; businessName: string | null }
  | { ok: false; bot?: true; status: number; error: string };

/** Validates the form body. Honeypot hits are reported as bot so the route can answer with a silent success. */
export function parseHearBody(b: HearInput, now: Date = new Date()): HearParsed {
  if (typeof b.website === 'string' && b.website.trim()) return { ok: false, bot: true, status: 200, error: 'bot' };
  if (b.shownVersion !== HEAR_CONSENT_VERSION || b.shownSha256 !== hearConsentSha256()) {
    return { ok: false, status: 409, error: 'This page is out of date. Please reload it and try again.' };
  }
  if (b.consent !== true) return { ok: false, status: 400, error: 'Please tick the box to agree to the call.' };
  const phone = typeof b.phone === 'string' ? normalizeNanp(b.phone) : null;
  if (!phone) return { ok: false, status: 400, error: 'Please enter a valid US phone number.' };
  const state = stateFromPhone(phone);
  if (!state || state === 'TF') return { ok: false, status: 400, error: 'We can only call US numbers with a local area code, not toll-free numbers.' };
  // A visitor asked for this call, so weekends are fine; the 8am-9pm local window still applies.
  const hours = checkCallingHours(state, now);
  if (!hours.ok && hours.reason !== 'weekend') {
    return { ok: false, status: 400, error: 'It is outside calling hours (8am to 9pm) where that number is. Please try again later.' };
  }
  return { ok: true, phone, state, businessName: cleanBusinessName(b.businessName) };
}

export type HearCounts = { phoneToday: number; ipToday: number; globalToday: number; onDoNotCall: boolean };
export function hearLimitError(c: HearCounts): { status: number; error: string } | null {
  if (c.onDoNotCall) return { status: 400, error: 'This number is on our do-not-call list. Email support@calldesk.tech if you would like to change that.' };
  if (c.phoneToday >= HEAR_LIMITS.perPhonePerDay) return { status: 429, error: 'We already called that number today. Please try again tomorrow.' };
  if (c.ipToday >= HEAR_LIMITS.perIpPerDay) return { status: 429, error: 'Too many requests. Please try again tomorrow.' };
  if (c.globalToday >= HEAR_LIMITS.globalPerDay) return { status: 429, error: 'The demo line is busy today. Please try again tomorrow.' };
  return null;
}
