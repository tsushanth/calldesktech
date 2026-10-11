const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 2026-10-08 -> "October 8, 2026". Deterministic (no locale or time zone). */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** ["a","b","c"] -> "a, b and c". */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Ends a sentence with a full stop unless it already ends with punctuation. */
export function sentence(s: string): string {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

export function lowerFirst(s: string): string {
  if (!s) return s;
  // Leave acronyms and proper-looking starts alone ("HIPAA", "SOC 2", "USD"): only a capital followed by lowercase is lowered.
  return /^[A-Z][a-z-]*(\s|$)/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

export const NOT_STATED = 'not stated on the pages we reviewed';
export const NOT_STATED_CAP = 'Not stated on the pages we reviewed';

export const BRAND_SUFFIX = ' | CallDeskTech';
export const TITLE_MAX = 70;

/** The first candidate that fits the title limit, with the brand suffix added only when it still fits. The last candidate is returned as is when none fits. */
export function fitTitle(...candidates: string[]): string {
  for (const c of candidates) {
    if ((c + BRAND_SUFFIX).length <= TITLE_MAX) return c + BRAND_SUFFIX;
    if (c.length <= TITLE_MAX) return c;
  }
  return candidates[candidates.length - 1];
}

export const DESC_MAX = 165;

/** The first candidate that fits the description limit; the last candidate is returned as is when none fits. */
export function fitDescription(...candidates: string[]): string {
  return candidates.find((c) => c.length <= DESC_MAX) ?? candidates[candidates.length - 1];
}

/** Possessive that copes with names ending in s ("ElevenLabs Agents'"). */
export const poss = (name: string): string => (name.endsWith('s') ? `${name}'` : `${name}'s`);

/** ["a","b","c"] -> "a, b or c". */
export const joinOr = (items: string[]): string => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`);

/** The label of a "Transcriber (example on page: ...)" or "Telephony: billed separately" style entry: the text before the first colon, bracket, price or plus sign. */
export function itemLabel(x: string): string {
  const head = x.split(/[:(]| [$+]\d?| \d/)[0].trim().replace(/[,;]$/, '');
  return head.length >= 3 ? head : x.trim();
}

/** Lowercases the first word only when it is a plain capitalised word ("Transcriber"), never a name or acronym ("ThunderPhone-provided", "HIPAA"). */
export function lowerLead(s: string): string {
  const first = s.split(/\s/)[0];
  return /^[A-Z][a-z-]+$/.test(first) ? s[0].toLowerCase() + s.slice(1) : s;
}
