import { describe, it, expect } from 'vitest';
import { buildDigest, digestIsQuiet, renderDigest, runCallIssuesDigest } from '@/lib/callIssuesDigest';

const issue = (code: string) => ({ issues: [{ code, severity: 'high', message: 'm', evidence: [], fix: 'f' }] });
const call = (o: Record<string, unknown>) => ({ id: 'c', created_at: '2026-10-05T00:00:00Z', duration_seconds: 60, outcome: 'completed', analysis: {}, ...o });

describe('buildDigest', () => {
  it('counts issues by code and flags failed or very short calls, ignoring internal tests', () => {
    const d = buildDigest([
      call({ id: 'a', analysis: issue('claimed_booking_without_tool') }),
      call({ id: 'b', outcome: 'failed' }),
      call({ id: 'c2', duration_seconds: 1 }),
      call({ id: 'd', analysis: issue('number_readback_mismatch'), is_internal_test: true }),
      call({ id: 'e' }),
    ] as never);
    expect(d.totalCalls).toBe(4);
    expect(d.callsWithIssues).toBe(1);
    expect(d.failedCalls).toBe(2);
    expect(d.byCode).toEqual({ claimed_booking_without_tool: 1 });
    expect(d.flagged.map((f) => f.id).sort()).toEqual(['a', 'b', 'c2']);
  });
  it('is quiet when nothing is flagged', () => {
    expect(digestIsQuiet(buildDigest([call({ id: 'x' })] as never))).toBe(true);
  });
});

describe('renderDigest', () => {
  it('escapes ids and puts the counts in the subject', () => {
    const r = renderDigest(buildDigest([call({ id: '<b>', outcome: 'failed' })] as never));
    expect(r.subject).toContain('1 failed');
    expect(r.html).not.toContain('<b>&');
    expect(r.html).toContain('&lt;b&gt;');
  });
});

describe('runCallIssuesDigest', () => {
  const db = (rows: unknown[]) => ({ from: () => ({ select: () => ({ gte: () => ({ order: () => ({ limit: async () => ({ data: rows, error: null }) }) }) }) }) }) as never;
  it('sends nothing on a quiet day, even when configured', async () => {
    let sent = 0;
    const r = await runCallIssuesDigest(db([call({})]), { env: { PILOT_ALERT_EMAIL: 'a@b.c', RESEND_API_KEY: 'k' }, send: async () => { sent++; return { ok: true }; } });
    expect(r.quiet).toBe(true); expect(sent).toBe(0);
  });
  it('sends one email when there is something to report, and none in a dry run or when unconfigured', async () => {
    let sent = 0; const send = async () => { sent++; return { ok: true }; };
    const rows = [call({ outcome: 'failed' })];
    expect((await runCallIssuesDigest(db(rows), { env: { PILOT_ALERT_EMAIL: 'a@b.c', RESEND_API_KEY: 'k' }, send })).sent).toBe(true);
    await runCallIssuesDigest(db(rows), { dry: true, env: { PILOT_ALERT_EMAIL: 'a@b.c', RESEND_API_KEY: 'k' }, send });
    await runCallIssuesDigest(db(rows), { env: {}, send });
    expect(sent).toBe(1);
  });
});
