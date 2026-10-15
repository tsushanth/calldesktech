/**
 * A phone number from a HighLevel contact as E.164, or null. HighLevel stores whatever the user typed, so accept the common
 * US shapes ("(415) 555-0123", "415-555-0123", "1 415 555 0123") and any number that already starts with +.
 * A number without a + and not a valid US shape is refused rather than guessed.
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  // US/Canada: area code and exchange never start with 0 or 1. This is what keeps "0412 345 678" (an Australian local
  // number, also 10 digits) from being dialled as +1 0412 345 678.
  const nanp = (d: string) => /^[2-9]\d{2}[2-9]\d{6}$/.test(d);
  if (digits.length === 10 && nanp(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1') && nanp(digits.slice(1))) return `+${digits}`;
  return null;
}

/** "first_name=Sam" lines (as typed in a HighLevel text box) into an object, or an error that names the bad line. */
export function parseVariableLines(raw: unknown): { ok: true; variables: Record<string, string> | undefined } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, variables: undefined };
  if (typeof raw !== 'string') return { ok: false, error: 'Call variables must be text, one name=value per line' };
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const eq = t.indexOf('=');
    if (eq < 1) return { ok: false, error: `Call variables: "${t.slice(0, 40)}" is not name=value` };
    const value = t.slice(eq + 1).trim();
    if (value) out[t.slice(0, eq).trim()] = value; // an empty value (a contact with no last name) is skipped, not an error
  }
  return { ok: true, variables: Object.keys(out).length ? out : undefined };
}
