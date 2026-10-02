// Which of our outbound numbers a call goes out from. Carrier analytics watch calls per number, so the line
// spreads dials across a small pool, caps each number per day, and prefers a number whose area code matches
// the person being called (a local-looking number is answered more often). Pure, so it is unit tested.

export interface PoolNumber {
  phone: string; // E.164
  area_codes: string[]; // area codes this number should be preferred for
  daily_cap: number;
  enabled: boolean;
}

// "+14256284887" -> "425"
export function areaCodeOf(e164: string | null | undefined): string | null {
  const m = /^\+1(\d{3})\d{7}$/.exec(String(e164 ?? ''));
  return m ? m[1] : null;
}

// usage: dials already placed today, per number. Returns null when every enabled number is at its cap (the
// caller must then refuse the call rather than overload a number).
export function pickPoolNumber(pool: PoolNumber[], usage: Record<string, number>, leadPhone: string | null): PoolNumber | null {
  const open = pool.filter((n) => n.enabled && (usage[n.phone] ?? 0) < n.daily_cap);
  if (open.length === 0) return null;
  const code = areaCodeOf(leadPhone);
  const local = code ? open.filter((n) => n.area_codes.includes(code)) : [];
  const candidates = local.length > 0 ? local : open;
  return candidates
    .slice()
    .sort((a, b) => (usage[a.phone] ?? 0) - (usage[b.phone] ?? 0) || a.phone.localeCompare(b.phone))[0];
}
