// International cold calling, OFF by default. A country is dialable from the sales line only when it is named in
// INTL_CALL_COUNTRIES (comma-separated ISO codes, e.g. "AU,GB,IN"); with the variable empty the line is US/Canada only,
// exactly as before. Numbers are checked against a per-country pattern that allows ordinary geographic and mobile lines
// and rejects premium-rate, personal-numbering and service ranges. Not legal advice: whether a country may be cold-called
// at all (do-not-call registers, calling hours, recording rules) is a separate decision made before it is listed here.

export interface IntlCountry {
  name: string;
  valid: RegExp; // E.164, ordinary callable lines only
  defaultState: string; // key into callingHours.STATE_ZONES (the lead's local clock)
}

export const INTL_COUNTRIES: Record<string, IntlCountry> = {
  AU: { name: 'Australia', valid: /^\+61(?:4\d{8}|[2378]\d{8}|13\d{4}|1300\d{6})$/, defaultState: 'AU-SYD' },
  NZ: { name: 'New Zealand', valid: /^\+64(?:[34679]\d{7}|2\d{7,9})$/, defaultState: 'NZ-AKL' },
  SG: { name: 'Singapore', valid: /^\+65[3689]\d{7}$/, defaultState: 'SG-SIN' },
  GB: { name: 'United Kingdom', valid: /^\+44(?:1\d{8,9}|2\d{9}|3\d{9}|7[1-57-9]\d{8})$/, defaultState: 'GB-LON' },
  IN: { name: 'India', valid: /^\+91(?:[6-9]\d{9}|[1-5]\d{9})$/, defaultState: 'IN-IST' },
  IE: { name: 'Ireland', valid: /^\+353(?:8[3-9]\d{7}|[1-9]\d{6,8})$/, defaultState: 'IE-DUB' },
};

const DIAL_CODES: Array<[string, string]> = [['353', 'IE'], ['61', 'AU'], ['64', 'NZ'], ['65', 'SG'], ['44', 'GB'], ['91', 'IN']];

export function intlCallCountries(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(
    String(env.INTL_CALL_COUNTRIES ?? '').split(',').map((s) => s.trim().toUpperCase()).filter((c) => INTL_COUNTRIES[c]),
  );
}

// "+61 468 035 416" / "0468035416" (only with a default country) -> { e164, iso } when the country is allowed and the number is a callable line.
export function normalizeIntl(raw: string | null | undefined, allowed: Set<string>): { e164: string; iso: string } | null {
  const s = String(raw ?? '').trim();
  if (!s.startsWith('+')) return null; // international format only, so a US number is never misread
  const e164 = `+${s.replace(/\D/g, '')}`;
  const digits = e164.slice(1);
  const hit = DIAL_CODES.find(([code]) => digits.startsWith(code));
  if (!hit) return null;
  const iso = hit[1];
  if (!allowed.has(iso) || !INTL_COUNTRIES[iso].valid.test(e164)) return null;
  return { e164, iso };
}

// Australia spans three clocks and Queensland keeps standard time all year; pick the lead's from its city when known.
const AU_CITY_STATE: Array<[RegExp, string]> = [
  [/\bperth\b|\bfremantle\b|\bmandurah\b/i, 'AU-PER'],
  [/\badelaide\b/i, 'AU-ADL'],
  [/\bbrisbane\b|\bgold coast\b|\bsunshine coast\b|\bcairns\b|\btownsville\b|\bqueensland\b/i, 'AU-BNE'],
];

export function intlState(iso: string, location: string | null | undefined): string | null {
  const c = INTL_COUNTRIES[iso];
  if (!c) return null;
  if (iso === 'AU') {
    const hit = AU_CITY_STATE.find(([re]) => re.test(String(location ?? '')));
    return hit ? hit[1] : c.defaultState;
  }
  return c.defaultState;
}
