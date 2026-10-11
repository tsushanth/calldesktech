import { describe, it, expect } from 'vitest';
import { buildSnapshot, dailyBuckets, currentStatus, overallState, windowDays, MIN_DAYS_FOR_UPTIME } from '@/lib/status/aggregate';
import { toPublicJson } from '@/lib/status/store';
import { NOW, allOperational, justStarted, withDegradedDayAndIncident, activeIncidentPartialOutage } from '../helpers/statusFixtures';

describe('dailyBuckets', () => {
  it('returns 90 days ending today; empty days are no_data, never operational', () => {
    const d = dailyBuckets([], 'web', NOW);
    expect(d).toHaveLength(90);
    expect(d[89].date).toBe('2026-10-10');
    expect(d.every((x) => x.status === 'no_data')).toBe(true);
  });

  it('worst status of the day wins', () => {
    const rows = [
      { component: 'web', day: '2026-10-09', status: 'operational' as const, n: 1000 },
      { component: 'web', day: '2026-10-09', status: 'degraded' as const, n: 2 },
      { component: 'web', day: '2026-10-08', status: 'operational' as const, n: 5 },
      { component: 'web', day: '2026-10-08', status: 'down' as const, n: 1 },
      { component: 'web', day: '2026-10-08', status: 'degraded' as const, n: 9 },
      { component: 'api', day: '2026-10-07', status: 'down' as const, n: 4 },
    ];
    const byDate = Object.fromEntries(dailyBuckets(rows, 'web', NOW).map((x) => [x.date, x.status]));
    expect(byDate['2026-10-09']).toBe('degraded');
    expect(byDate['2026-10-08']).toBe('down');
    expect(byDate['2026-10-07']).toBe('no_data'); // another component's data does not leak in
    expect(byDate['2026-10-06']).toBe('no_data');
  });
});

describe('current status and overall state', () => {
  it('a stale latest check is unknown, not its old status', () => {
    expect(currentStatus({ status: 'operational', latency_ms: 1, checked_at: new Date(NOW.getTime() - 6 * 60_000).toISOString() }, NOW)).toBe('unknown');
    expect(currentStatus({ status: 'down', latency_ms: 1, checked_at: new Date(NOW.getTime() - 60_000).toISOString() }, NOW)).toBe('down');
    expect(currentStatus(null, NOW)).toBe('unknown');
  });

  it('maps component states to the banner', () => {
    const c = (...s: ('operational' | 'degraded' | 'down' | 'unknown')[]) => s.map((status) => ({ status }));
    const old = '2026-01-01T00:00:00.000Z';
    expect(overallState(c('operational', 'operational'), old, NOW)).toBe('operational');
    expect(overallState(c('operational', 'degraded'), old, NOW)).toBe('degraded');
    expect(overallState(c('operational', 'down'), old, NOW)).toBe('partial_outage');
    expect(overallState(c('down', 'down'), old, NOW)).toBe('major_outage');
    expect(overallState(c('operational', 'unknown'), old, NOW)).toBe('stale');
    expect(overallState(c('unknown', 'unknown'), null, NOW)).toBe('starting');
    expect(overallState(c('operational'), new Date(NOW.getTime() - 600_000).toISOString(), NOW)).toBe('starting');
  });
});

describe('snapshots', () => {
  it('90 days of data shows uptime and operational banner', () => {
    const s = allOperational();
    expect(s.overall).toBe('operational');
    expect(s.uptimeShown).toBe(true);
    expect(s.components.every((c) => c.uptimePercent === 100)).toBe(true);
  });

  it('under 7 days: no uptime percentage', () => {
    const s = justStarted();
    expect(s.overall).toBe('starting');
    expect(s.uptimeShown).toBe(false);
    expect(s.components.every((c) => c.uptimePercent === null)).toBe(true);
    expect(s.components[0].days.filter((d) => d.status === 'no_data')).toHaveLength(89);
  });

  it('exactly the 7-day threshold needs 7 days of data, not just an old start date', () => {
    const base = allOperational();
    const sparse = buildSnapshot({
      now: NOW, components: base.components.map(({ id, name, description }) => ({ id, name, description })),
      rollups: [{ component: 'web', day: '2026-10-10', status: 'operational', n: 50 }], latest: {}, monitoringSince: '2026-09-01T00:00:00.000Z', incidents: [],
    });
    expect(MIN_DAYS_FOR_UPTIME).toBe(7);
    expect(sparse.uptimeShown).toBe(false);
  });

  it('uptime counts only failed checks against completed checks', () => {
    const s = withDegradedDayAndIncident();
    const engine = s.components.find((c) => c.id === 'engine')!;
    expect(engine.uptimePercent).toBe(99.99); // 3 failed of ~126k checks must not round up to 100
    expect(s.components.find((c) => c.id === 'voice')!.uptimePercent).toBe(100); // degraded is not down
  });

  it('keeps incidents from the last 30 days, newest first', () => {
    const s = activeIncidentPartialOutage();
    expect(s.overall).toBe('partial_outage');
    expect(s.incidents.map((i) => i.id)).toEqual(['inc-2', 'inc-1']);
  });

  it('public JSON has the documented shape and no internal fields', () => {
    const j = toPublicJson(withDegradedDayAndIncident());
    expect(Object.keys(j).sort()).toEqual(['checksInWindow', 'components', 'generatedAt', 'incidents', 'lastCheckedAt', 'monitoringSince', 'overall']);
    expect(j.components).toHaveLength(4);
    expect(Object.keys(j.components[0]).sort()).toEqual(['days', 'id', 'lastCheckedAt', 'latencyMs', 'name', 'status', 'uptimePercent']);
    expect(j.components[0].days).toHaveLength(90);
    expect(Object.keys(j.incidents[0]).sort()).toEqual(['body', 'component', 'id', 'resolvedAt', 'startedAt', 'status', 'title']);
    const text = JSON.stringify(j);
    expect(text).not.toMatch(/activeCalls|fly\.dev|http_code|inflight/);
    expect(windowDays(NOW)).toHaveLength(90);
  });
});
