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
  // Canadian provinces (territories are left out: Yukon, Northwest Territories and Nunavut span several zones).
  ON: ['America/Toronto', 'America/Winnipeg'], QC: ['America/Toronto'], BC: ['America/Vancouver', 'America/Edmonton'],
  AB: ['America/Edmonton'], SK: ['America/Regina'], MB: ['America/Winnipeg'],
  NS: ['America/Halifax'], NB: ['America/Halifax'], PE: ['America/Halifax'], NL: ['America/St_Johns', 'America/Halifax'],
  // 'TF' is not a place: a toll-free number (800, 833, 844, 855, 866, 877, 888) says nothing about where the business
  // is, so it is held to the window that is lawful on every continental US and Canadian coast at once (Eastern and
  // Pacific, 9:00 start, so roughly noon to 9 PM Eastern).
  TF: ['America/New_York', 'America/Los_Angeles'],
  // International leads (see intlCalling.ts): one key per local clock, held to business hours, 9:00 to 17:00 Monday to Friday.
  'AU-SYD': ['Australia/Sydney'], 'AU-BNE': ['Australia/Brisbane'], 'AU-ADL': ['Australia/Adelaide'], 'AU-PER': ['Australia/Perth'],
  'NZ-AKL': ['Pacific/Auckland'], 'SG-SIN': ['Asia/Singapore'], 'GB-LON': ['Europe/London'], 'IN-IST': ['Asia/Kolkata'], 'IE-DUB': ['Europe/Dublin'],
};

// Keys above that are not US states or Canadian provinces: a business-hours window instead of the US/Canada one.
export const INTL_STATES = new Set(['AU-SYD', 'AU-BNE', 'AU-ADL', 'AU-PER', 'NZ-AKL', 'SG-SIN', 'GB-LON', 'IN-IST', 'IE-DUB']);
const INTL_START_HOUR = 9;
const INTL_END_HOUR = 17; // exclusive

// Canada's telemarketing rules start the calling day at 9:00 local time; the US window starts at 8:00.
const CANADA = new Set(['ON', 'QC', 'BC', 'AB', 'SK', 'MB', 'NS', 'NB', 'PE', 'NL', 'TF']);

// "Fort Myers, FL", "Toronto, ON", "Spydeberg, NO" -> "FL" / "ON" / null (not a US state or Canadian province, so it is never batched).
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
    const intl = INTL_STATES.has(state as string);
    if (minutes < (intl ? INTL_START_HOUR : CANADA.has(state as string) ? 9 : CALL_START_HOUR) * 60) return { ok: false, reason: 'too_early' };
    if (minutes >= (intl ? INTL_END_HOUR : CALL_END_HOUR) * 60) return { ok: false, reason: 'too_late' };
  }
  return { ok: true };
}

// The lead's local time in its primary zone, for display ("2:05 PM").
export function localTimeLabel(state: string | null | undefined, now: Date = new Date()): string | null {
  const zone = state ? STATE_ZONES[state]?.[0] : undefined;
  if (!zone) return null;
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(now);
}

// A batch day starts at 6:00 AM US Eastern (3:00 AM Pacific), not at midnight. Callers on Manila hours work 5 to 11 PM
// Pacific, which is 8 PM to 2 AM Eastern, so a midnight Eastern rollover swapped their list in the middle of a shift.
// Nobody works between 3 and 6 AM Pacific, so one shift now stays on one list from start to finish.
export const BATCH_DAY_START_HOUR_ET = 6;

function easternParts(now: Date): { y: number; m: number; d: number; hour: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hour: Number(p.hour) };
}

// The batch date a call belongs to, as YYYY-MM-DD: the Eastern calendar date, except that the hours before 6:00 AM
// Eastern still belong to the previous day. Read from the Eastern wall clock, so the March and November clock changes
// cannot move it by an hour.
export function batchDateEastern(now: Date = new Date()): string {
  const { y, m, d, hour } = easternParts(now);
  const day = new Date(Date.UTC(y, m - 1, d - (hour < BATCH_DAY_START_HOUR_ET ? 1 : 0)));
  return day.toISOString().slice(0, 10);
}

// The instant the current batch day began (6:00 AM Eastern), as a Date, for "dials today" counts. Eastern switches
// between UTC-5 and UTC-4, so both are tried and the one that is 6:00 AM in New York on that day is kept.
export function startOfEasternDay(now: Date = new Date()): Date {
  const [y, m, d] = batchDateEastern(now).split('-').map(Number);
  for (const utcHour of [BATCH_DAY_START_HOUR_ET + 4, BATCH_DAY_START_HOUR_ET + 5]) {
    const t = new Date(Date.UTC(y, m - 1, d, utcHour, 0, 0));
    const e = easternParts(t);
    if (e.hour === BATCH_DAY_START_HOUR_ET && e.y === y && e.m === m && e.d === d) return t;
  }
  return new Date(Date.UTC(y, m - 1, d, BATCH_DAY_START_HOUR_ET + 5, 0, 0));
}
