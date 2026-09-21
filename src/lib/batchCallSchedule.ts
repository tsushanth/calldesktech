// Shared between the batch-call create route (validates the shape) and the
// run route (enforces it at dial time) — mirrors Retell's own
// call_time_window: an optional timezone + day-of-week + hour range outside
// of which a batch won't dial.

export interface CallTimeWindow {
  timezone: string; // IANA name, e.g. "America/New_York"
  days: number[]; // 0 (Sun) - 6 (Sat)
  start_hour: number; // 0-23, inclusive
  end_hour: number; // 0-23, exclusive
}

export function validateCallTimeWindow(input: unknown): CallTimeWindow | null {
  if (input == null) return null;
  if (typeof input !== 'object') throw new Error('callTimeWindow must be an object');
  const w = input as Record<string, unknown>;
  const timezone = w.timezone;
  const days = w.days;
  const start = w.start_hour;
  const end = w.end_hour;
  if (typeof timezone !== 'string' || !timezone.trim()) throw new Error('callTimeWindow.timezone is required');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new Error(`callTimeWindow.timezone "${timezone}" is not a valid IANA timezone`);
  }
  if (!Array.isArray(days) || !days.length || days.some((d) => typeof d !== 'number' || d < 0 || d > 6)) {
    throw new Error('callTimeWindow.days must be a non-empty array of 0-6 (Sun-Sat)');
  }
  if (typeof start !== 'number' || start < 0 || start > 23 || typeof end !== 'number' || end < 1 || end > 24 || end <= start) {
    throw new Error('callTimeWindow.start_hour/end_hour must be 0-23/1-24 with end after start');
  }
  return { timezone, days: days as number[], start_hour: start, end_hour: end };
}

// True when `at` falls inside the window, in the window's own timezone.
export function isWithinCallWindow(window: CallTimeWindow | null | undefined, at: Date): boolean {
  if (!window) return true;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: window.timezone,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(at);
  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value || '';
  const hourStr = parts.find((p) => p.type === 'hour')?.value || '0';
  const dayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayStr);
  // Intl's hour12:false can render midnight as "24" — normalize to 0.
  const hour = Number(hourStr) % 24;
  return window.days.includes(dayIndex) && hour >= window.start_hour && hour < window.end_hour;
}
