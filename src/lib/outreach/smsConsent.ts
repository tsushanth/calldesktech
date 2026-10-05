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

export interface ConsentInput { phone: string | null; smsOptIn: boolean; honeypot: string }

export type ParseResult =
  | { ok: true; phone: string; smsOptIn: boolean }
  | { ok: false; status: number; error: string };

/** Validates the form body. A filled honeypot field is treated as a bot (the caller answers it with a fake success). */
export function parseConsentBody(body: unknown): ParseResult | { bot: true } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.website === 'string' && b.website.trim() !== '') return { bot: true };
  const phone = normalizeNanp(String(b.phone ?? ''));
  if (!phone) return { ok: false, status: 400, error: 'Enter a valid US mobile number, for example (415) 555-0123.' };
  return { ok: true, phone, smsOptIn: b.smsOptIn === true };
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
