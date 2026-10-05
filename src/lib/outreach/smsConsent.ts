import { createHash } from 'crypto';
import { normalizeNanp } from '@/lib/outboundCalling';

// SMS marketing consent captured on /try. The wording below is what the person sees next to the checkbox and is stored
// verbatim with every consent (with its version), so it can be shown to a carrier or in a dispute. If you change the
// wording, bump CONSENT_VERSION: old consents keep the text they actually agreed to.
// DRAFT: have counsel review before any marketing text is sent, and make it match the registered 10DLC marketing campaign.
export const CONSENT_VERSION = '2026-10-05-v1';
export const CONSENT_TEXT =
  'Yes, send me text messages with offers and product updates from Calldesk (operated by KREATIVEKOALASOLUTIONS LLC) at the mobile number above. ' +
  'Message frequency varies. Message and data rates may apply. Consent is not a condition of getting the coupon or of any purchase. ' +
  'Reply STOP to opt out or HELP for help.';

// Everything the person sees on /try, in one object, so the page and the audit record cannot drift apart. The page renders FROM this and
// the API stores it (as JSON, with its hash) on every submission. Change any of it and bump CONSENT_VERSION.
export const FORM_COPY = {
  page: '/try',
  headline: 'Try Calldesk',
  intro: 'Get a trial coupon for your first Calldesk invoice. Enter your mobile number and we will show it right away.',
  phoneLabel: 'Mobile number',
  consentCheckboxDefaultChecked: false,
  consentLabel: CONSENT_TEXT,
  consentLinks: ['/privacy', '/terms'],
  optionalNote: 'The text-message box is optional. You get the coupon either way.',
  submitLabel: 'Get my coupon',
} as const;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const consentSha256 = (text: string = CONSENT_TEXT) => sha256(text);
export const formCopyJson = () => JSON.stringify(FORM_COPY);
export const formSha256 = () => sha256(formCopyJson());

export interface ConsentInput { phone: string | null; smsOptIn: boolean; honeypot: string }

export type ParseResult =
  | { ok: true; phone: string; smsOptIn: boolean; shownVersion: string; shownSha256: string }
  | { ok: false; status: number; error: string };

/** Validates the form body. A filled honeypot field is treated as a bot (the caller answers it with a fake success). */
export function parseConsentBody(body: unknown): ParseResult | { bot: true } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.website === 'string' && b.website.trim() !== '') return { bot: true };
  const phone = normalizeNanp(String(b.phone ?? ''));
  if (!phone) return { ok: false, status: 400, error: 'Enter a valid US mobile number, for example (415) 555-0123.' };
  return { ok: true, phone, smsOptIn: b.smsOptIn === true, shownVersion: String(b.consentVersion ?? ''), shownSha256: String(b.consentSha256 ?? '') };
}

/** The wording the browser says it showed must be the wording we have now; otherwise the page is stale and we must not record consent against it. */
export function shownMatchesCurrent(shownVersion: string, shownSha256: string): boolean {
  return shownVersion === CONSENT_VERSION && shownSha256 === consentSha256();
}

export type SmsStatus = 'declined' | 'pending_campaign' | 'suppressed_stop_on_file';

/** A STOP on file wins over a new web opt-in: the person must text START themselves to resubscribe. */
export function smsStatusFor(smsOptIn: boolean, optedOutOnFile: boolean): SmsStatus {
  if (!smsOptIn) return 'declined';
  return optedOutOnFile ? 'suppressed_stop_on_file' : 'pending_campaign';
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export function generateCouponCode(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `CALLDESK-${out}`;
}

export const COUPON_ID = 'outreach-signup-credit'; // same $10 once-off coupon as scripts/create-promo-code.mjs
export const COUPON_DAYS = 30;

export function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
