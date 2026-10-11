import { getSupabaseAdmin } from '@/lib/supabase';
import { buildSnapshot, windowStart, type ComponentDef } from './aggregate';
import { buildTargets } from './probe';
import type { DayRollupRow, Incident, LatestCheck, ProbeResult, StatusSnapshot } from './types';

export async function saveProbeResults(results: ProbeResult[]): Promise<void> {
  if (results.length === 0) return;
  const { error } = await getSupabaseAdmin().from('calldesk_status_checks').insert(results);
  if (error) throw new Error(`status insert failed: ${error.message}`);
}

/** Reads the last 90 days and folds them into the public snapshot. Throws if the database is unreachable. */
export async function getStatusSnapshot(now: Date = new Date()): Promise<StatusSnapshot> {
  const db = getSupabaseAdmin();
  const defs: ComponentDef[] = buildTargets().map(({ id, name, description }) => ({ id, name, description }));
  const since = windowStart(now);

  const [rollups, firstCheck, incidents, ...latestRows] = await Promise.all([
    db.rpc('calldesk_status_daily', { since: since.toISOString() }),
    db.from('calldesk_status_checks').select('checked_at').order('checked_at', { ascending: true }).limit(1),
    db.from('calldesk_status_incidents').select('id, component, title, status, body, started_at, resolved_at')
      .gte('started_at', new Date(now.getTime() - 30 * 86_400_000).toISOString()).order('started_at', { ascending: false }).limit(50),
    ...defs.map((d) =>
      db.from('calldesk_status_checks').select('status, latency_ms, checked_at').eq('component', d.id)
        .order('checked_at', { ascending: false }).limit(1)),
  ]);
  for (const r of [rollups, firstCheck, incidents, ...latestRows]) if (r.error) throw new Error(`status read failed: ${r.error.message}`);

  const latest: Record<string, LatestCheck | null> = {};
  defs.forEach((d, i) => { latest[d.id] = (latestRows[i].data?.[0] as LatestCheck | undefined) ?? null; });

  const rows: DayRollupRow[] = ((rollups.data ?? []) as { component: string; day: string; status: DayRollupRow['status']; n: number | string }[])
    .map((r) => ({ component: r.component, day: String(r.day).slice(0, 10), status: r.status, n: Number(r.n) }));

  return buildSnapshot({
    now,
    components: defs,
    rollups: rows,
    latest,
    monitoringSince: (firstCheck.data?.[0]?.checked_at as string | undefined) ?? null,
    incidents: (incidents.data ?? []) as Incident[],
  });
}

/** The public JSON contract: exactly the snapshot fields, nothing internal. */
export function toPublicJson(s: StatusSnapshot) {
  return {
    generatedAt: s.generatedAt,
    overall: s.overall,
    monitoringSince: s.monitoringSince,
    checksInWindow: s.totalChecks,
    lastCheckedAt: s.lastCheckedAt,
    components: s.components.map((c) => ({
      id: c.id, name: c.name, status: c.status, lastCheckedAt: c.lastCheckedAt, latencyMs: c.latencyMs,
      uptimePercent: c.uptimePercent, days: c.days,
    })),
    incidents: s.incidents.map((i) => ({
      id: i.id, component: i.component, title: i.title, status: i.status, body: i.body, startedAt: i.started_at, resolvedAt: i.resolved_at,
    })),
  };
}
