import { describe, it, expect, vi } from 'vitest';
import { runPilotWatch, runPilotWeeklyReport, buildWeeklyDigest, weekKeyFor, loadPilots } from '@/lib/pilotJobs';
import { makeFakeDb } from '../helpers/fakePilotDb';

const START = Date.parse('2026-10-05T16:00:00.000Z');
const at = (h: number) => new Date(START + h * 3600_000);
const iso = (h: number) => at(h).toISOString();
const ENV = { PILOT_ALERT_EMAIL: 'owner@example.com', RESEND_API_KEY: 'x', NEXTAUTH_URL: 'https://app.test' };

function seed(extraCalls: Array<Record<string, unknown>> = [], pilotOver: Record<string, unknown> = {}) {
  return {
    calldesk_tenants: [{ id: 'ten1', name: 'Acme Dental', pilot_blocked: false }],
    calldesk_pilots: [{
      id: 'pil1', tenant_id: 'ten1', contact_name: 'Dana', contact_email: 'dana@pilot-customer.com', company: 'Acme Dental', vertical: 'dental',
      started_at: iso(0), ends_at: iso(24 * 7), minutes_cap: 50, status: 'active', notes: null, created_at: iso(0), ...pilotOver,
    }],
    calldesk_pilot_events: [],
    calldesk_call_logs: extraCalls.map((c, i) => ({ id: `call${i}`, tenant_id: 'ten1', outcome: 'answered', analysis: null, is_internal_test: false, ...c })),
  };
}
const send = () => vi.fn(async () => ({ ok: true, id: 'e1' }));

describe('runPilotWatch', () => {
  it('dry run reports what it would send and writes nothing', async () => {
    const db = makeFakeDb(seed([{ created_at: iso(2), duration_seconds: 2700 }]));
    const s = send();
    const r = await runPilotWatch(db as never, { dry: true, now: at(5), env: ENV, send: s });
    expect(r.dry).toBe(true);
    expect(r.emails.map((e) => e.kinds)).toEqual([['cap_80']]);
    expect(r.emails[0].result).toBe('would_send');
    expect(r.emails[0].to).toBe('owner@example.com');
    expect(s).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
    expect(db.tables.calldesk_pilot_events).toEqual([]);
  });

  it('dry run works with no env at all', async () => {
    const db = makeFakeDb(seed());
    const r = await runPilotWatch(db as never, { dry: true, now: at(30), env: {}, send: send() });
    expect(r.configured).toBe(false);
    expect(r.emails.map((e) => e.kinds)).toEqual([['no_calls_24h']]);
  });

  it('sends nothing and writes no markers when env is missing', async () => {
    for (const env of [{}, { PILOT_ALERT_EMAIL: 'o@example.com' }, { RESEND_API_KEY: 'x' }]) {
      const db = makeFakeDb(seed());
      const s = send();
      const r = await runPilotWatch(db as never, { now: at(30), env, send: s });
      expect(s).not.toHaveBeenCalled();
      expect(r.skipped).toMatch(/not set/);
      expect(r.emails[0].result).toBe('not_configured');
      expect(db.tables.calldesk_pilot_events).toEqual([]);
    }
  });

  it('is idempotent: a second run sends nothing new, and a new event sends only itself', async () => {
    const db = makeFakeDb(seed([{ created_at: iso(2), duration_seconds: 2700 }]));
    const s = send();
    const first = await runPilotWatch(db as never, { now: at(5), env: ENV, send: s });
    expect(first.emails.map((e) => e.result)).toEqual(['sent']);
    const second = await runPilotWatch(db as never, { now: at(6), env: ENV, send: s });
    expect(second.emails).toEqual([]);
    expect(s).toHaveBeenCalledTimes(1);
    expect(db.tables.calldesk_pilot_events.map((e) => e.event_key)).toEqual(['pil1:cap_80']);

    db.tables.calldesk_call_logs.push({ id: 'cN', tenant_id: 'ten1', created_at: iso(7), duration_seconds: 600, outcome: 'answered', analysis: null, is_internal_test: false });
    const third = await runPilotWatch(db as never, { now: at(8), env: ENV, send: s });
    expect(third.emails.map((e) => e.kinds)).toEqual([['cap_100']]);
    expect(s).toHaveBeenCalledTimes(2);
  });

  it('emails only the owner, never the pilot contact', async () => {
    const db = makeFakeDb(seed([{ created_at: iso(2), duration_seconds: 3100 }]));
    const s = send();
    await runPilotWatch(db as never, { now: at(5), env: ENV, send: s });
    const calls = s.mock.calls as unknown as Array<[{ to: string; subject: string; html: string; text: string }]>;
    for (const [p] of calls) {
      expect(p.to).toBe('owner@example.com');
      expect(JSON.stringify(p)).not.toContain('pilot-customer.com');
    }
  });

  it('batches failed and short calls into one email with a marker per call', async () => {
    const db = makeFakeDb(seed([
      { created_at: iso(1), duration_seconds: 60, analysis: { call_successful: false } },
      { created_at: iso(2), duration_seconds: 4 },
      { created_at: iso(3), duration_seconds: 300 },
    ]));
    const s = send();
    const r = await runPilotWatch(db as never, { now: at(5), env: ENV, send: s });
    expect(r.emails).toHaveLength(1);
    expect(r.emails[0].keys).toHaveLength(2);
    expect(s).toHaveBeenCalledTimes(1);
    expect(db.tables.calldesk_pilot_events).toHaveLength(2);
  });

  it('releases the marker when the send fails so the next run retries', async () => {
    const db = makeFakeDb(seed([{ created_at: iso(2), duration_seconds: 2700 }]));
    const bad = vi.fn(async () => ({ ok: false, error: 'boom' }));
    const r1 = await runPilotWatch(db as never, { now: at(5), env: ENV, send: bad });
    expect(r1.emails[0].result).toBe('failed');
    expect(db.tables.calldesk_pilot_events).toEqual([]);
    const r2 = await runPilotWatch(db as never, { now: at(6), env: ENV, send: send() });
    expect(r2.emails[0].result).toBe('sent');
  });

  it('keeps status and the block flag in step, and does not write in dry run', async () => {
    const db = makeFakeDb(seed([{ created_at: iso(2), duration_seconds: 3100 }]));
    const dry = await runPilotWatch(db as never, { dry: true, now: at(5), env: ENV, send: send() });
    expect(dry.statusChanges).toEqual([{ pilotId: 'pil1', from: 'active', to: 'capped' }]);
    expect(dry.flagChanges).toEqual([{ tenantId: 'ten1', blocked: true, applied: false }]);
    expect(db.tables.calldesk_tenants[0].pilot_blocked).toBe(false);

    const live = await runPilotWatch(db as never, { now: at(5), env: {}, send: send() });
    expect(live.flagChanges[0].applied).toBe(true);
    expect(db.tables.calldesk_tenants[0]).toMatchObject({ pilot_blocked: true, pilot_blocked_reason: 'cap' });
    expect(db.tables.calldesk_pilots[0].status).toBe('capped');
    // converged: a later run changes nothing
    const again = await runPilotWatch(db as never, { now: at(6), env: {}, send: send() });
    expect(again.flagChanges).toEqual([]);
    expect(again.statusChanges).toEqual([]);
  });

  it('does nothing about the flag when the column is absent', async () => {
    const db = makeFakeDb(seed([{ created_at: iso(2), duration_seconds: 3100 }]), { noFlagColumn: true });
    const r = await runPilotWatch(db as never, { now: at(5), env: {}, send: send() });
    expect(r.flagChanges).toEqual([]);
    expect(db.writes.filter((w) => w.table === 'calldesk_tenants')).toEqual([]);
    expect(db.tables.calldesk_pilots[0].status).toBe('capped');
  });

  it('reports a skip when the migration is not applied', async () => {
    const db = makeFakeDb(seed(), { noPilotsTable: true });
    const r = await runPilotWatch(db as never, { now: at(30), env: ENV, send: send() });
    expect(r.skipped).toMatch(/068/);
    expect(r.emails).toEqual([]);
  });

  it('a stopped pilot is blocked but raises no emails', async () => {
    const db = makeFakeDb(seed([], { status: 'stopped' }));
    const r = await runPilotWatch(db as never, { now: at(30), env: ENV, send: send() });
    expect(r.emails).toEqual([]);
    expect(db.tables.calldesk_tenants[0].pilot_blocked).toBe(true);
  });
});

describe('weekly report', () => {
  const calls = [
    { created_at: iso(1), duration_seconds: 300, outcome: 'booked', analysis: { call_summary: 'Booked a cleaning, asked about insurance', user_sentiment: 'Positive' } },
    { created_at: iso(2), duration_seconds: 200, outcome: 'answered', analysis: { call_summary: 'Asked about insurance coverage' } },
    { created_at: iso(3), duration_seconds: 5, outcome: 'abandoned' },
  ];
  const now = at(24 * 7); // Monday 2026-10-12 16:00 UTC

  it('weekKeyFor is the UTC Monday', () => {
    expect(weekKeyFor(new Date('2026-10-12T15:00:00Z'))).toBe('2026-10-12');
    expect(weekKeyFor(new Date('2026-10-18T23:59:00Z'))).toBe('2026-10-12');
    expect(weekKeyFor(new Date('2026-10-11T00:00:00Z'))).toBe('2026-10-05');
  });

  it('digest has usage, outcomes, follow-ups and topics, deterministically', async () => {
    const db = makeFakeDb(seed(calls));
    const { rows } = await loadPilots(db as never);
    const d1 = buildWeeklyDigest(rows, now, ENV);
    const d2 = buildWeeklyDigest(rows, now, ENV);
    expect(d1).toEqual(d2);
    expect(d1.pilots).toBe(1);
    expect(d1.text).toContain('Acme Dental');
    expect(d1.text).toContain('3 calls');
    expect(d1.text).toContain('Next:');
    expect(d1.text).toContain('https://app.test/admin/pilots/pil1');
    expect(d1.topics[0]).toEqual({ topic: 'insurance', count: 2 });
  });

  it('dry run returns the digest and sends nothing', async () => {
    const db = makeFakeDb(seed(calls));
    const s = send();
    const r = await runPilotWeeklyReport(db as never, { dry: true, now, env: {}, send: s });
    expect(r.result).toBe('would_send');
    expect(r.subject).toMatch(/Pilot digest/);
    expect(s).not.toHaveBeenCalled();
    expect(db.tables.calldesk_pilot_events).toEqual([]);
  });

  it('does not send or mark without env; sends once per week with env; owner only', async () => {
    const db = makeFakeDb(seed(calls));
    const s = send();
    const none = await runPilotWeeklyReport(db as never, { now, env: {}, send: s });
    expect(none.skipped).toMatch(/not set/);
    expect(s).not.toHaveBeenCalled();
    expect(db.tables.calldesk_pilot_events).toEqual([]);

    const a = await runPilotWeeklyReport(db as never, { now, env: ENV, send: s });
    const b = await runPilotWeeklyReport(db as never, { now: new Date(now.getTime() + 3600_000), env: ENV, send: s });
    expect([a.result, b.result]).toEqual(['sent', 'already_sent']);
    expect(s).toHaveBeenCalledTimes(1);
    expect((s.mock.calls as unknown as Array<[{ to: string }]>)[0][0].to).toBe('owner@example.com');
    expect(db.tables.calldesk_pilot_events[0].event_key).toBe('weekly:2026-10-12');
  });

  it('skips when there are no pilots', async () => {
    const db = makeFakeDb({ ...seed(), calldesk_pilots: [] });
    const r = await runPilotWeeklyReport(db as never, { now, env: ENV, send: send() });
    expect(r.skipped).toMatch(/no pilots/);
  });
});
