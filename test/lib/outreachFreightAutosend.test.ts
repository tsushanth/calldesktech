import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAutosend } from '@/lib/outreach/autosend';
import { makeDb } from '../helpers/fakeDb';

const T0 = new Date('2026-09-29T18:00:00Z'); // Tue 11:00 Pacific
const at = (k: number) => new Date(T0.getTime() + k * 30 * 60_000);
const US = { replied_at: null, region_blocked: false, source_key: 'freight:mc:100', location: 'Cole Camp, MO', signals: {} };
const NO = { replied_at: null, region_blocked: false, source_key: 'freight:no:9', location: 'Oslo', signals: {} };
const m = (id: string, step: number, lead: Record<string, unknown> = US, extra: Record<string, unknown> = {}) => ({ id, status: 'approved', step, product: 'calldesk:freight', lead, created_at: `2026-09-2${step}T00:00:0${id.length}Z`, ...extra });

beforeEach(() => {
  process.env.OUTREACH_AUTOSEND = 'on'; process.env.OUTREACH_TZ = 'America/Los_Angeles';
  process.env.OUTREACH_DAILY_CAP = '20'; delete process.env.OUTREACH_SEND_HOURS; delete process.env.OUTREACH_FOLLOWUP_DAILY_CAP;
});

// A send stub that behaves like sendApprovedMessage's success path against the fake db.
const sender = (db: ReturnType<typeof makeDb>, when: () => Date) => vi.fn(async (id: string) => {
  const row = db.tables.calldesk_outreach_messages.find((r) => r.id === id)!;
  row.status = 'sent'; row.sent_at = when().toISOString();
  return { ok: true as const };
});

describe('autosend: freight US-only', () => {
  it('fails a non-US freight message instead of sending it, and sends the next US one', async () => {
    const db = makeDb({ calldesk_outreach_messages: [m('n1', 1, NO), m('u2', 1)] });
    const send = sender(db, () => T0);
    const out = await runAutosend(db as never, { lanes: ['calldesk'], now: T0, send });
    expect(out.calldesk).toEqual({ action: 'sent', messageId: 'u2' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(db.tables.calldesk_outreach_messages.find((r) => r.id === 'n1')).toMatchObject({ status: 'failed', error: expect.stringMatching(/US-only/) });
  });
  it('a dry run skips it without writing anything', async () => {
    const db = makeDb({ calldesk_outreach_messages: [m('n1', 1, NO), m('u2', 1)] });
    const out = await runAutosend(db as never, { lanes: ['calldesk'], now: T0, dry: true });
    expect(out.calldesk).toEqual({ action: 'would_send', messageId: 'u2' });
    expect(db.updates).toEqual([]);
  });
  it('nothing_approved when the only approved messages are non-US freight', async () => {
    const db = makeDb({ calldesk_outreach_messages: [m('n1', 1, NO)] });
    expect((await runAutosend(db as never, { lanes: ['calldesk'], now: T0, dry: true })).calldesk).toEqual({ action: 'nothing_approved' });
  });
  it('does not apply to other verticals', async () => {
    const db = makeDb({ calldesk_outreach_messages: [{ ...m('d1', 1, NO), product: 'calldesk:dental' }] });
    expect((await runAutosend(db as never, { lanes: ['calldesk'], now: T0, dry: true })).calldesk).toEqual({ action: 'would_send', messageId: 'd1' });
  });
});

describe('autosend: follow-up priority and daily cap', () => {
  it('sends follow-ups first up to OUTREACH_FOLLOWUP_DAILY_CAP, then only first touches', async () => {
    process.env.OUTREACH_FOLLOWUP_DAILY_CAP = '2';
    const db = makeDb({ calldesk_outreach_messages: [m('f1', 1), m('f2', 1), m('u1', 2), m('u2', 2), m('u3', 2)] });
    let tick = 0;
    const send = sender(db, () => at(tick));
    const order: string[] = [];
    for (tick = 0; tick < 5; tick++) {
      const r = (await runAutosend(db as never, { lanes: ['calldesk'], now: at(tick), send })).calldesk;
      if (r?.action === 'sent') order.push(r.messageId);
    }
    expect(order).toEqual(['u1', 'u2', 'f1', 'f2']);
    // the third follow-up waits for tomorrow
    expect(db.tables.calldesk_outreach_messages.find((r) => r.id === 'u3')!.status).toBe('approved');
  });
  it('with a cap of 0 no follow-up is sent', async () => {
    process.env.OUTREACH_FOLLOWUP_DAILY_CAP = '0';
    const db = makeDb({ calldesk_outreach_messages: [m('u1', 2)] });
    expect((await runAutosend(db as never, { lanes: ['calldesk'], now: T0, dry: true })).calldesk).toEqual({ action: 'nothing_approved' });
  });
  it('default cap is half the daily send cap', async () => {
    process.env.OUTREACH_DAILY_CAP = '4'; // => 2 follow-ups a day
    const db = makeDb({ calldesk_outreach_messages: [m('f1', 1), m('u1', 2), m('u2', 2), m('u3', 2)] });
    let tick = 0;
    const send = sender(db, () => at(tick));
    const order: string[] = [];
    for (tick = 0; tick < 4; tick++) {
      const r = (await runAutosend(db as never, { lanes: ['calldesk'], now: at(tick * 4), send })).calldesk;
      if (r?.action === 'sent') order.push(r.messageId);
    }
    expect(order).toEqual(['u1', 'u2', 'f1']);
  });
  it('still skips a follow-up whose lead replied', async () => {
    const db = makeDb({ calldesk_outreach_messages: [m('u1', 2, { ...US, replied_at: '2026-09-28T00:00:00Z' }), m('f1', 1)] });
    expect((await runAutosend(db as never, { lanes: ['calldesk'], now: T0, dry: true })).calldesk).toEqual({ action: 'would_send', messageId: 'f1' });
  });
});
