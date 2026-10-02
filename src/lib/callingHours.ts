// When a US business may be cold-called, from its state. The sales line only ever dials numbers from a
// caller's daily batch, and each batch row carries the lead's state, so the gate can refuse a call
// outside legal calling hours without any caller having to check a clock.
//
// Window: 8:00 to 21:00 local time, Monday to Friday. A state that spans two time zones is held to the
// stricter edge of both (e.g. Florida: 9:00 Eastern to 21:00 Eastern, so it is still 8:00 in the panhandle).
// Not legal advice; adjust the constants if counsel says otherwise.

export const CALL_START_HOUR = 8;
export const CALL_END_HOUR = 21; // exclusive: the last legal minute is 20:59

// Every IANA zone a state touches (the primary zone first).
export const STATE_ZONES: Record<string, string[]> = {
  AL: ['America/Chicago'], AK: ['America/Anchorage'], AZ: ['America/Phoenix'], AR: ['America/Chicago'],
  CA: ['America/Los_Angeles'], CO: ['America/Denver'], CT: ['America/New_York'], DE: ['America/New_York'],
  DC: ['America/New_York'], FL: ['America/New_York', 'America/Chicago'], GA: ['America/New_York'],
  HI: ['Pacific/Honolulu'], ID: ['America/Boise', 'America/Los_Angeles'], IL: ['America/Chicago'],
  IN: ['America/Indiana/Indianapolis', 'America/Chicago'], IA: ['America/Chicago'],
  KS: ['America/Chicago', 'America/Denver'], KY: ['America/New_York', 'America/Chicago'],
  LA: ['America/Chicago'], ME: ['America/New_York'], MD: ['America/New_York'], MA: ['America/New_York'],
  MI: ['America/Detroit', 'America/Chicago'], MN: ['America/Chicago'], MS: ['America/Chicago'],
  MO: ['America/Chicago'], MT: ['America/Denver'], NE: ['America/Chicago', 'America/Denver'],
  NV: ['America/Los_Angeles', 'America/Denver'], NH: ['America/New_York'], NJ: ['America/New_York'],
  NM: ['America/Denver'], NY: ['America/New_York'], NC: ['America/New_York'],
  ND: ['America/Chicago', 'America/Denver'], OH: ['America/New_York'], OK: ['America/Chicago'],
  OR: ['America/Los_Angeles', 'America/Boise'], PA: ['America/New_York'], RI: ['America/New_York'],
  SC: ['America/New_York'], SD: ['America/Chicago', 'America/Denver'],
  TN: ['America/Chicago', 'America/New_York'], TX: ['America/Chicago', 'America/Denver'],
  UT: ['America/Denver'], VT: ['America/New_York'], VA: ['America/New_York'], WA: ['America/Los_Angeles'],
  WV: ['America/New_York'], WI: ['America/Chicago'], WY: ['America/Denver'],
};

// "Fort Myers, FL", "Spydeberg, NO" -> "FL" / null (not a US state, so it is never batched).
export function stateFromLocation(location: string | null | undefined): string | null {
  const m = /,\s*([A-Z]{2})\s*(?:\d{5}(?:-\d{4})?)?\s*$/.exec(String(location ?? '').trim());
  return m && STATE_ZONES[m[1]] ? m[1] : null;
}

function localParts(zone: string, now: Date): { weekday: string; minutes: number } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export type HoursCheck = { ok: true } | { ok: false; reason: 'unknown_state' | 'weekend' | 'too_early' | 'too_late' };

export function checkCallingHours(state: string | null | undefined, now: Date = new Date()): HoursCheck {
  const zones = state ? STATE_ZONES[state] : undefined;
  if (!zones) return { ok: false, reason: 'unknown_state' };
  for (const zone of zones) {
    const { weekday, minutes } = localParts(zone, now);
    if (weekday === 'Sat' || weekday === 'Sun') return { ok: false, reason: 'weekend' };
    if (minutes < CALL_START_HOUR * 60) return { ok: false, reason: 'too_early' };
    if (minutes >= CALL_END_HOUR * 60) return { ok: false, reason: 'too_late' };
  }
  return { ok: true };
}

// The lead's local time in its primary zone, for display ("2:05 PM").
export function localTimeLabel(state: string | null | undefined, now: Date = new Date()): string | null {
  const zone = state ? STATE_ZONES[state]?.[0] : undefined;
  if (!zone) return null;
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(now);
}

// The batch date a call belongs to: the calendar date in US Eastern (callers work Eastern business hours,
// so one batch is one Eastern day), as YYYY-MM-DD.
export function batchDateEastern(now: Date = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

// The instant a US Eastern calendar day began (00:00 Eastern), as a Date, for "dials today" counts. Eastern
// switches between UTC-5 and UTC-4, so the offset is read from Intl for that exact day, not hard-coded.
export function startOfEasternDay(now: Date = new Date()): Date {
  const [y, m, d] = batchDateEastern(now).split('-').map(Number);
  // Midnight Eastern is 04:00 or 05:00 UTC: try both and keep the one that is midnight in New York.
  for (const hour of [4, 5]) {
    const t = new Date(Date.UTC(y, m - 1, d, hour, 0, 0));
    const hh = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(t);
    if (Number(hh) === 0 && batchDateEastern(t) === batchDateEastern(now)) return t;
  }
  return new Date(Date.UTC(y, m - 1, d, 5, 0, 0));
}
