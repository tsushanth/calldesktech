// Planning a day's call batches: which earlier voicemails come back for their one retry, how fresh numbers are
// dealt between callers when some callers already have retries, and where retries sit in the working order.
// Pure, so it is unit tested (the builder script that uses it is not).

export interface PreviousRow {
  sip_username: string;
  phone: string;
  lead_id: string | null;
  company_name: string;
  state: string | null;
  attempt: number;
  outcome: string | null;
  /** Hour (0-23, US Eastern) of the caller's last dial of this number, when known. */
  hourET?: number | null;
}

// A number logged as "voicemail" on its first attempt comes back exactly once, to the same caller, unless it has
// since been blocked or already been retried. Capped per caller so retries never crowd out fresh numbers.
export function selectRetries(
  rows: PreviousRow[],
  opts: { blocked: Set<string>; alreadyRetried: Set<string>; maxPerCaller: number },
): PreviousRow[] {
  const taken: Record<string, number> = {};
  const seen = new Set<string>();
  const out: PreviousRow[] = [];
  for (const r of rows) {
    if (r.attempt !== 1 || r.outcome !== 'voicemail') continue;
    if (opts.blocked.has(r.phone) || opts.alreadyRetried.has(r.phone) || seen.has(r.phone)) continue;
    if ((taken[r.sip_username] ?? 0) >= opts.maxPerCaller) continue;
    seen.add(r.phone);
    taken[r.sip_username] = (taken[r.sip_username] ?? 0) + 1;
    out.push(r);
  }
  return out;
}

// Deal items to callers one at a time, always to the caller with the most room left (ties go to the earlier caller),
// so callers with fewer open slots get proportionally fewer. Input order is kept within each caller.
export function dealWithQuotas<T>(items: T[], callers: string[], quota: Record<string, number>): Record<string, T[]> {
  const out: Record<string, T[]> = Object.fromEntries(callers.map((c) => [c, []]));
  for (const item of items) {
    let best: string | null = null;
    let bestRoom = 0;
    for (const c of callers) {
      const room = (quota[c] ?? 0) - out[c].length;
      if (room > bestRoom) { best = c; bestRoom = room; }
    }
    if (best === null) break;
    out[best].push(item);
  }
  return out;
}

// A retry should land at a different time of day than the first try. The first try was in the morning (before
// 1 PM Eastern) -> retry late in the shift; first try in the afternoon, or unknown -> retry at the start.
export function orderWithRetries<T>(fresh: T[], retries: (T & { hourET?: number | null })[]): T[] {
  const early = retries.filter((r) => r.hourET != null && r.hourET < 13);
  const late = retries.filter((r) => !(r.hourET != null && r.hourET < 13));
  return [...late, ...fresh, ...early];
}
