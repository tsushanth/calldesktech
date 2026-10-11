import { buildSnapshot, windowDays } from '@/lib/status/aggregate';
import { buildTargets } from '@/lib/status/probe';
import type { DayRollupRow, Incident, LatestCheck, StatusSnapshot } from '@/lib/status/types';

export const NOW = new Date('2026-10-10T12:00:00.000Z');
const defs = buildTargets({}).map(({ id, name, description }) => ({ id, name, description }));

function rollupsForDays(daysBack: number, overrides: Record<string, Record<string, Partial<Record<'degraded' | 'down', number>>>> = {}): DayRollupRow[] {
  const all = windowDays(NOW).slice(-daysBack);
  const rows: DayRollupRow[] = [];
  for (const d of defs) for (const day of all) {
    const o = overrides[d.id]?.[day] ?? {};
    rows.push({ component: d.id, day, status: 'operational', n: 1400 });
    if (o.degraded) rows.push({ component: d.id, day, status: 'degraded', n: o.degraded });
    if (o.down) rows.push({ component: d.id, day, status: 'down', n: o.down });
  }
  return rows;
}

const freshLatest = (ms = 180): Record<string, LatestCheck> =>
  Object.fromEntries(defs.map((d) => [d.id, { status: 'operational', latency_ms: ms, checked_at: new Date(NOW.getTime() - 30_000).toISOString() }]));

const since = (daysBack: number) => new Date(NOW.getTime() - daysBack * 86_400_000).toISOString();

export function allOperational(): StatusSnapshot {
  return buildSnapshot({ now: NOW, components: defs, rollups: rollupsForDays(90), latest: freshLatest(), monitoringSince: since(95), incidents: [] });
}

export function withDegradedDayAndIncident(): StatusSnapshot {
  const days = windowDays(NOW);
  const incident: Incident = {
    id: 'inc-1', component: 'voice', title: 'Slower voice responses', status: 'resolved',
    body: 'The speech gateway was slow for about 40 minutes. Calls continued but the agent paused longer before replying.',
    started_at: `${days[days.length - 10]}T14:05:00.000Z`, resolved_at: `${days[days.length - 10]}T14:48:00.000Z`,
  };
  return buildSnapshot({
    now: NOW, components: defs,
    rollups: rollupsForDays(90, { voice: { [days[days.length - 10]]: { degraded: 40 } }, engine: { [days[days.length - 30]]: { down: 3 } } }),
    latest: freshLatest(), monitoringSince: since(95), incidents: [incident],
  });
}

export function justStarted(): StatusSnapshot {
  const day = windowDays(NOW)[89];
  const rows: DayRollupRow[] = defs.map((d) => ({ component: d.id, day, status: 'operational' as const, n: 12 }));
  const latest = Object.fromEntries(defs.map((d) => [d.id, { status: 'operational' as const, latency_ms: 210, checked_at: new Date(NOW.getTime() - 20_000).toISOString() }]));
  return buildSnapshot({ now: NOW, components: defs, rollups: rows, latest, monitoringSince: since(0.01), incidents: [] });
}

export function activeIncidentPartialOutage(): StatusSnapshot {
  const base = withDegradedDayAndIncident();
  const latest = freshLatest();
  latest.engine = { ...latest.engine, status: 'down', latency_ms: 8001 };
  const inc: Incident = { id: 'inc-2', component: 'engine', title: 'Call engine not responding', status: 'investigating', body: 'We are investigating failed health checks on the call engine.', started_at: new Date(NOW.getTime() - 20 * 60_000).toISOString(), resolved_at: null };
  return buildSnapshot({ now: NOW, components: defs, rollups: rollupsForDays(90), latest, monitoringSince: since(95), incidents: [...base.incidents, inc] });
}
