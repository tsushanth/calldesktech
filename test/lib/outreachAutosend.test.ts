import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAutosend, sendWindow } from '@/lib/outreach/autosend';

type Ctx = { table: string; head: boolean; hasIn: boolean; eq: Record<string, unknown>; order: string[] };
interface World {
  sentCount?: number; lastSentAt?: string | null; events?: { message_id: string; event: string }[];
  bounceMessageIds?: string[]; approved?: { id: string; lead: { replied_at: string | null } | null }[];
}
function fake(w: World) {
  const handler = (c: Ctx): { data?: unknown; count?: number } => {
    if (c.table === 'calldesk_outreach_email_events') return { data: w.events ?? [] };
    if (c.head) return { count: w.sentCount ?? 0 };
    if (c.hasIn) return { data: (w.bounceMessageIds ?? []).map((id) => ({ id })) };
    if (c.eq.status === 'approved') return { data: w.approved ?? [] };
    if (c.order.includes('sent_at')) return { data: w.lastSentAt ? [{ sent_at: w.lastSentAt }] : [] };
    return { data: [] };
  };
  return {
    from(table: string) {
      const c: Ctx = { table, head: false, hasIn: false, eq: {}, order: [] };
      const q: Record<string, unknown> = {
        select: (_s: string, o?: { head?: boolean }) => { c.head = !!o?.head; return q; },
        eq: (k: string, v: unknown) => { c.eq[k] = v; return q; },
        in: () => { c.hasIn = true; return q; },
        or: () => q, gte: () => q, not: () => q, like: () => q, limit: () => q,
        order: (col: string) => { c.order.push(col); return q; },
        then: (res: (v: unknown) => unknown) => res(handler(c)),
      };
      return q;
    },
  } as never;
}

const TUE_11AM_PT = new Date('2026-09-29T18:00:00Z');
const OK: World = { sentCount: 5, approved: [{ id: 'm1', lead: { replied_at: null } }] };

beforeEach(() => {
  process.env.OUTREACH_AUTOSEND = 'on';
  process.env.OUTREACH_DAILY_CAP = '15';
  process.env.OUTREACH_TZ = 'America/Los_Angeles';
  delete process.env.OUTREACH_SEND_HOURS;
});

describe('runAutosend', () => {
  it('does nothing unless OUTREACH_AUTOSEND is on', async () => {
    delete process.env.OUTREACH_AUTOSEND;
    const send = vi.fn();
    expect(await runAutosend(fake(OK), { now: TUE_11AM_PT, send })).toEqual({ action: 'disabled' });
    expect(send).not.toHaveBeenCalled();
  });

  it('does not send on weekends or outside the window', async () => {
    const send = vi.fn();
    expect(await runAutosend(fake(OK), { now: new Date('2026-09-26T18:00:00Z'), send })).toMatchObject({ action: 'outside_window' });
    expect(await runAutosend(fake(OK), { now: new Date('2026-09-29T03:00:00Z'), send })).toMatchObject({ action: 'outside_window' });
    expect(await runAutosend(fake(OK), { now: new Date('2026-09-29T23:30:00Z'), send })).toMatchObject({ action: 'outside_window' });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the next approved message', async () => {
    const send = vi.fn(async () => ({ ok: true as const }));
    expect(await runAutosend(fake(OK), { now: TUE_11AM_PT, send })).toEqual({ action: 'sent', messageId: 'm1' });
    expect(send).toHaveBeenCalledWith('m1');
  });

  it('skips leads that already replied', async () => {
    const send = vi.fn(async () => ({ ok: true as const }));
    const w = { ...OK, approved: [{ id: 'm1', lead: { replied_at: '2026-09-28T00:00:00Z' } }, { id: 'm2', lead: { replied_at: null } }] };
    expect(await runAutosend(fake(w), { now: TUE_11AM_PT, send })).toEqual({ action: 'sent', messageId: 'm2' });
  });

  it('reports nothing_approved when the queue has no approved messages', async () => {
    expect(await runAutosend(fake({ sentCount: 0, approved: [] }), { now: TUE_11AM_PT })).toEqual({ action: 'nothing_approved' });
  });

  it('stops at the daily cap', async () => {
    const send = vi.fn();
    expect(await runAutosend(fake({ ...OK, sentCount: 15 }), { now: TUE_11AM_PT, send })).toEqual({ action: 'cap_reached', sent: 15, cap: 15 });
    expect(send).not.toHaveBeenCalled();
  });

  it('spaces sends across the window (7h / 15 sends, 90% => 25 min)', async () => {
    const send = vi.fn();
    const recent = new Date(TUE_11AM_PT.getTime() - 10 * 60_000).toISOString();
    expect(await runAutosend(fake({ ...OK, lastSentAt: recent }), { now: TUE_11AM_PT, send })).toEqual({ action: 'too_soon', minutesSinceLast: 10, minGapMinutes: 25 });
    expect(send).not.toHaveBeenCalled();
    const older = new Date(TUE_11AM_PT.getTime() - 26 * 60_000).toISOString();
    expect(await runAutosend(fake({ ...OK, lastSentAt: older }), { now: TUE_11AM_PT, send: async () => ({ ok: true as const }) })).toMatchObject({ action: 'sent' });
  });

  it('pauses on any spam complaint', async () => {
    const send = vi.fn();
    const w = { ...OK, events: [{ message_id: 'x', event: 'complained' }], bounceMessageIds: ['x'] };
    expect(await runAutosend(fake(w), { now: TUE_11AM_PT, send })).toMatchObject({ action: 'paused_health' });
    expect(send).not.toHaveBeenCalled();
  });

  it('pauses when the 7-day bounce rate reaches 5% (with at least 20 sends)', async () => {
    process.env.OUTREACH_DAILY_CAP = '100';
    const send = vi.fn();
    const w = { ...OK, sentCount: 40, events: [{ message_id: 'a', event: 'bounced' }, { message_id: 'b', event: 'bounced' }], bounceMessageIds: ['a', 'b'] };
    expect(await runAutosend(fake(w), { now: TUE_11AM_PT, send })).toMatchObject({ action: 'paused_health' });
    const few = { ...w, sentCount: 10 };
    expect(await runAutosend(fake(few), { now: TUE_11AM_PT, send: async () => ({ ok: true as const }) })).toMatchObject({ action: 'sent' });
  });

  it('dry run reports the message without sending', async () => {
    const send = vi.fn();
    expect(await runAutosend(fake(OK), { now: TUE_11AM_PT, dry: true, send })).toEqual({ action: 'would_send', messageId: 'm1' });
    expect(send).not.toHaveBeenCalled();
  });

  it('surfaces a failed send', async () => {
    expect(await runAutosend(fake(OK), { now: TUE_11AM_PT, send: async () => ({ ok: false as const, error: 'nope' }) })).toEqual({ action: 'send_failed', messageId: 'm1', error: 'nope' });
  });

  it('ignores a nonsense OUTREACH_SEND_HOURS', () => {
    process.env.OUTREACH_SEND_HOURS = '17-9';
    expect(sendWindow()).toEqual({ start: 9, end: 16 });
  });
});
