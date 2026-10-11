import type {
  CheckStatus, ComponentSnapshot, CurrentStatus, DayRollupRow, DayStatus, Incident, LatestCheck, OverallState, StatusSnapshot,
} from './types';

export const WINDOW_DAYS = 90;
/** Uptime percentages stay hidden until this many days of real data exist. */
export const MIN_DAYS_FOR_UPTIME = 7;
/** A latest check older than this means the scheduler stopped; we show "unknown", never the old status. */
export const STALE_AFTER_MS = 5 * 60_000;
/** Within this long of the first recorded check the page says monitoring just started. */
export const STARTING_WINDOW_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

export interface ComponentDef { id: string; name: string; description: string }

const RANK: Record<CheckStatus, number> = { operational: 0, degraded: 1, down: 2 };

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** The 90 UTC dates ending at `now`, oldest first. */
export function windowDays(now: Date): string[] {
  const out: string[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) out.push(isoDay(new Date(now.getTime() - i * DAY_MS)));
  return out;
}

/** Start of the oldest day in the window, for the DB query. */
export function windowStart(now: Date): Date {
  return new Date(`${windowDays(now)[0]}T00:00:00.000Z`);
}

/** Worst status of each day wins. A day with no rows is 'no_data', never operational. */
export function dailyBuckets(rows: DayRollupRow[], component: string, now: Date): { date: string; status: DayStatus }[] {
  const worstByDay = new Map<string, CheckStatus>();
  for (const r of rows) {
    if (r.component !== component || r.n <= 0) continue;
    const cur = worstByDay.get(r.day);
    if (!cur || RANK[r.status] > RANK[cur]) worstByDay.set(r.day, r.status);
  }
  return windowDays(now).map((date) => ({ date, status: worstByDay.get(date) ?? 'no_data' }));
}

export function currentStatus(latest: LatestCheck | null | undefined, now: Date): CurrentStatus {
  if (!latest) return 'unknown';
  if (now.getTime() - new Date(latest.checked_at).getTime() > STALE_AFTER_MS) return 'unknown';
  return latest.status;
}

export function overallState(components: Pick<ComponentSnapshot, 'status'>[], monitoringSince: string | null, now: Date): OverallState {
  if (components.length === 0 || components.every((c) => c.status === 'unknown') && !monitoringSince) return 'starting';
  const down = components.filter((c) => c.status === 'down').length;
  if (down > 0) return down === components.length ? 'major_outage' : 'partial_outage';
  if (components.some((c) => c.status === 'degraded')) return 'degraded';
  if (components.some((c) => c.status === 'unknown')) return 'stale';
  if (monitoringSince && now.getTime() - new Date(monitoringSince).getTime() < STARTING_WINDOW_MS) return 'starting';
  return 'operational';
}

export interface SnapshotInput {
  now: Date;
  components: ComponentDef[];
  rollups: DayRollupRow[];
  latest: Record<string, LatestCheck | null>;
  monitoringSince: string | null;
  incidents: Incident[];
}

export function buildSnapshot(input: SnapshotInput): StatusSnapshot {
  const { now, rollups, latest, monitoringSince } = input;
  const monitoringDays = monitoringSince ? (now.getTime() - new Date(monitoringSince).getTime()) / DAY_MS : 0;

  const components: ComponentSnapshot[] = input.components.map((def) => {
    const days = dailyBuckets(rollups, def.id, now);
    const mine = rollups.filter((r) => r.component === def.id);
    const checks = mine.reduce((s, r) => s + r.n, 0);
    const downChecks = mine.filter((r) => r.status === 'down').reduce((s, r) => s + r.n, 0);
    const daysWithData = days.filter((d) => d.status !== 'no_data').length;
    // Honest uptime: only after a week of real data, and only over checks actually made.
    const uptimePercent = monitoringDays >= MIN_DAYS_FOR_UPTIME && daysWithData >= MIN_DAYS_FOR_UPTIME && checks > 0
      ? Math.floor(((checks - downChecks) / checks) * 10_000) / 100 // floor: failures never round up to 100%
      : null;
    const l = latest[def.id] ?? null;
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      status: currentStatus(l, now),
      lastCheckedAt: l?.checked_at ?? null,
      latencyMs: l && currentStatus(l, now) !== 'unknown' ? l.latency_ms : null,
      days,
      checks,
      uptimePercent,
    };
  });

  const lastCheckedAt = Object.values(latest).reduce<string | null>(
    (acc, l) => (l && (!acc || l.checked_at > acc) ? l.checked_at : acc), null);
  const cutoff = now.getTime() - 30 * DAY_MS;

  return {
    generatedAt: now.toISOString(),
    overall: overallState(components, monitoringSince, now),
    monitoringSince,
    totalChecks: components.reduce((s, c) => s + c.checks, 0),
    uptimeShown: components.some((c) => c.uptimePercent !== null),
    lastCheckedAt,
    components,
    incidents: input.incidents
      .filter((i) => !i.resolved_at || new Date(i.started_at).getTime() >= cutoff || new Date(i.resolved_at).getTime() >= cutoff)
      .sort((a, b) => b.started_at.localeCompare(a.started_at)),
  };
}
