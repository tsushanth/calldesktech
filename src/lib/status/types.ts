export type CheckStatus = 'operational' | 'degraded' | 'down';
/** What the page shows for a component right now. 'unknown' = no recent check (never guess). */
export type CurrentStatus = CheckStatus | 'unknown';
/** One daily bucket. 'no_data' = nothing was recorded that day; it is never rendered as healthy. */
export type DayStatus = CheckStatus | 'no_data';
export type OverallState = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'starting' | 'stale';

export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';

export interface ProbeResult {
  component: string;
  status: CheckStatus;
  http_code: number | null;
  latency_ms: number | null;
  checked_at: string;
}

export interface DayRollupRow {
  component: string;
  day: string; // YYYY-MM-DD (UTC)
  status: CheckStatus;
  n: number;
}

export interface LatestCheck {
  status: CheckStatus;
  latency_ms: number | null;
  checked_at: string;
}

export interface Incident {
  id: string;
  component: string | null;
  title: string;
  status: IncidentStatus;
  body: string | null;
  started_at: string;
  resolved_at: string | null;
}

export interface ComponentSnapshot {
  id: string;
  name: string;
  description: string;
  status: CurrentStatus;
  lastCheckedAt: string | null;
  latencyMs: number | null;
  days: { date: string; status: DayStatus }[];
  checks: number;
  /** Null until >= 7 days of real data exist. */
  uptimePercent: number | null;
}

export interface StatusSnapshot {
  generatedAt: string;
  overall: OverallState;
  monitoringSince: string | null;
  /** Checks recorded in the 90-day window. */
  totalChecks: number;
  uptimeShown: boolean;
  lastCheckedAt: string | null;
  components: ComponentSnapshot[];
  incidents: Incident[];
}
