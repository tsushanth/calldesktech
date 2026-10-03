import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followUpAutoApprove, followUpDailyCap, followUpDraftProblem, followUpDueDay, followUpPerRunCap, isFollowUpDue } from '@/lib/outreach/followUps';
import { makeDb } from '../helpers/fakeDb';

const draftFollowUpEmail = vi.fn();
const draftAgencyEmail = vi.fn();
vi.mock('@/lib/outreach/agencyDraft', () => ({
  draftFollowUpEmail: (...a: unknown[]) => draftFollowUpEmail(...a),
  draftAgencyEmail: (...a: unknown[]) => draftAgencyEmail(...a),
}));

import { findDueFollowUps, resolveMaxFollowUps, stageDraft, stageFollowUp } from '@/lib/outreach/discovery/pipeline';
import { freight, calldesk, dental } from '@/lib/outreach/products';
import { pickFreightArm } from '@/lib/outreach/freight';

const DAY = 86_400_000;
const NOW = new Date('2026-10-12T18:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

describe('cadence rules', () => {
  it('step 2 is due on day 4 and step 3 on day 9, counted from the first email', () => {
    expect(followUpDueDay(2)).toBe(4);
    expect(followUpDueDay(3)).toBe(9);
    const first = ago(4.1);
    expect(isFollowUpDue(2, { firstSentAt: first, latestSentAt: first }, NOW)).toBe(true);
    expect(isFollowUpDue(2, { firstSentAt: ago(3.9), latestSentAt: ago(3.9) }, NOW)).toBe(false);
    // step 3: day 9 from the first send AND at least 2 days after step 2
    expect(isFollowUpDue(3, { firstSentAt: ago(9.1), latestSentAt: ago(5) }, NOW)).toBe(true);
    expect(isFollowUpDue(3, { firstSentAt: ago(8.5), latestSentAt: ago(4.4) }, NOW)).toBe(false);
    expect(isFollowUpDue(3, { firstSentAt: ago(10), latestSentAt: ago(1) }, NOW)).toBe(false); // step 2 went out late
    expect(isFollowUpDue(1, { firstSentAt: ago(10), latestSentAt: ago(10) }, NOW)).toBe(false);
    expect(isFollowUpDue(2, { firstSentAt: null, latestSentAt: null }, NOW)).toBe(false);
  });
  it('OUTREACH_FOLLOWUP_DELAY_DAYS shifts the whole schedule', () => {
    expect(followUpDueDay(2, 7)).toBe(7);
    expect(followUpDueDay(3, 7)).toBe(12);
  });
  it('freight sends 3 touches (2 follow-ups); the other verticals keep their defaults', () => {
    expect(resolveMaxFollowUps(freight, undefined)).toBe(3);
    expect(resolveMaxFollowUps(dental, undefined)).toBe(2);
    expect(resolveMaxFollowUps(calldesk, undefined)).toBe(3);
    expect(resolveMaxFollowUps(freight, '0')).toBe(0);
    expect(resolveMaxFollowUps(freight, '2')).toBe(2); // env still wins
  });
});

describe('auto-approve switches and caps', () => {
  it('is on for freight only by default, off with OUTREACH_FOLLOWUP_AUTOAPPROVE=0, scoped by the products list', () => {
    expect(followUpAutoApprove('freight', {})).toBe(true);
    expect(followUpAutoApprove('dental', {})).toBe(false);
    expect(followUpAutoApprove('calldesk', {})).toBe(false);
    expect(followUpAutoApprove('freight', { OUTREACH_FOLLOWUP_AUTOAPPROVE: '0' })).toBe(false);
    expect(followUpAutoApprove('freight', { OUTREACH_FOLLOWUP_AUTOAPPROVE: '1' })).toBe(true);
    expect(followUpAutoApprove('dental', { OUTREACH_FOLLOWUP_AUTOAPPROVE_PRODUCTS: 'freight,dental' })).toBe(true);
    expect(followUpAutoApprove('towing', { OUTREACH_FOLLOWUP_AUTOAPPROVE_PRODUCTS: '*' })).toBe(true);
    expect(followUpAutoApprove('freight', { OUTREACH_FOLLOWUP_AUTOAPPROVE: '0', OUTREACH_FOLLOWUP_AUTOAPPROVE_PRODUCTS: '*' })).toBe(false);
  });
  it('daily follow-up cap defaults to half the lane cap and honours a valid override', () => {
    expect(followUpDailyCap(20, undefined)).toBe(10);
    expect(followUpDailyCap(15, undefined)).toBe(8);
    expect(followUpDailyCap(20, '4')).toBe(4);
    expect(followUpDailyCap(20, '0')).toBe(0);
    expect(followUpDailyCap(20, 'oops')).toBe(10);
    expect(followUpDailyCap(20, '')).toBe(10);
    expect(followUpDailyCap(20, '99999')).toBe(500);
    expect(followUpPerRunCap(undefined)).toBe(30);
    expect(followUpPerRunCap('5')).toBe(5);
    expect(followUpPerRunCap('0')).toBe(30);
  });
  it('guardrails keep off-offer follow-ups out of auto-approval', () => {
    expect(followUpDraftProblem('freight', 'free_week', 'Hi there, quick bump on the one-week pilot. Reply yes?')).toBeNull();
    expect(followUpDraftProblem('freight', null, 'Still free for two weeks if you want to try it.')).toMatch(/other than one week/);
    expect(followUpDraftProblem('freight', null, 'It is a 14-day trial.')).toMatch(/other than one week/);
    expect(followUpDraftProblem('freight', null, 'Then $99 a month.')).toMatch(/price/);
    expect(followUpDraftProblem('freight', null, 'See https://calldesk.tech')).toMatch(/link/);
    expect(followUpDraftProblem('freight', 'demo', 'Can we show you a free pilot?')).toMatch(/demo arm/);
    expect(followUpDraftProblem('freight', 'demo', 'Would 15 minutes this week work for a demo?')).toBeNull();
    expect(followUpDraftProblem('calldesk:freight', 'free_week', 'two weeks')).toMatch(/other than one week/);
  });
});

// ---- the stage itself, against an in-memory db ----
const lead = (id: string, extra: Record<string, unknown> = {}) => ({ id, company_name: `Broker ${id}`, domain: null, tier: null, location: 'Cole Camp, MO', description: 'd', status: 'sent', region_blocked: false, replied_at: null, source_key: `freight:mc:${id.replace(/\D/g, '') || '1'}00`, signals: {}, product: 'calldesk:freight', ...extra });
const msg = (leadId: string, step: number, status: string, sentDaysAgo: number | null, extra: Record<string, unknown> = {}) => ({ id: `m-${leadId}-${step}-${status}`, lead_id: leadId, step, status, subject: 'Help with carrier calls', to_email: `${leadId}@broker.co`, product: 'calldesk:freight', sent_at: sentDaysAgo == null ? null : ago(sentDaysAgo), ...extra });

const summary = () => ({ dryRun: false, followUpsCreated: 0, errors: [] as string[], sample: { enriched: [], researched: [] } }) as never;
type Summ = { followUpsCreated: number; followUpsAutoApproved?: number; errors: string[]; followUpPlan?: { company: string; step: number }[] };

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  draftFollowUpEmail.mockReset();
  draftFollowUpEmail.mockResolvedValue({ subject: 'Re: Help with carrier calls', body: 'Hi there,\n\nQuick bump on the one-week pilot, capped at 50 minutes. Reply yes with the number to forward from?\n\nSushanth & Deepika' });
  delete process.env.OUTREACH_FOLLOWUP_AUTOAPPROVE; delete process.env.OUTREACH_FOLLOWUP_AUTOAPPROVE_PRODUCTS; delete process.env.OUTREACH_MAX_FOLLOWUPS;
  delete process.env.OUTREACH_DAILY_CAP; delete process.env.OUTREACH_FOLLOWUP_DAILY_CAP; delete process.env.OUTREACH_FREIGHT_EXPERIMENT;
});
afterEach(() => { vi.useRealTimers(); });

const MSGS = 'calldesk_outreach_messages';
const LEADS = 'calldesk_outreach_leads';
const run = (db: ReturnType<typeof makeDb>, s: Summ = summary() as unknown as Summ, dry = false) => stageFollowUp(db as never, s as never, dry, () => false, freight).then(() => s);

describe('stageFollowUp (freight)', () => {
  it('drafts AND auto-approves day-4 and day-9 follow-ups, never past maxFollowUps', async () => {
    const db = makeDb({
      [LEADS]: [lead('a1'), lead('b2'), lead('c3')],
      [MSGS]: [
        msg('a1', 1, 'sent', 5), // due: step 2
        msg('b2', 1, 'sent', 10), msg('b2', 2, 'sent', 5.5), // due: step 3 (final)
        msg('c3', 1, 'sent', 20), msg('c3', 2, 'sent', 15), msg('c3', 3, 'sent', 10), // exhausted at 3 touches
      ],
    });
    const s = await run(db);
    expect(s.errors).toEqual([]);
    expect(s.followUpsCreated).toBe(2);
    expect(s.followUpsAutoApproved).toBe(2);
    const created = db.inserts.map((i) => i.row);
    expect(created.map((r) => `${r.lead_id}:${r.step}:${r.status}`).sort()).toEqual(['a1:2:approved', 'b2:3:approved']);
    expect(created.every((r) => typeof r.approved_at === 'string')).toBe(true);
    expect(created.every((r) => r.product === 'calldesk:freight')).toBe(true);
    // the final touch is flagged to the drafter
    const calls = draftFollowUpEmail.mock.calls.map((c) => c[0] as { step: number; isFinal: boolean });
    expect(calls.find((c) => c.step === 3)?.isFinal).toBe(true);
    expect(calls.find((c) => c.step === 2)?.isFinal).toBe(false);
  });

  it('OUTREACH_FOLLOWUP_AUTOAPPROVE=0 leaves them as drafts for manual approval', async () => {
    process.env.OUTREACH_FOLLOWUP_AUTOAPPROVE = '0';
    const db = makeDb({ [LEADS]: [lead('a1')], [MSGS]: [msg('a1', 1, 'sent', 5)] });
    const s = await run(db);
    expect(db.inserts.map((i) => i.row.status)).toEqual(['draft']);
    expect(db.inserts[0].row.approved_at).toBeUndefined();
    expect(s.followUpsAutoApproved).toBeUndefined();
  });

  it('honours every stop condition and the in-flight rule', async () => {
    const db = makeDb({
      [LEADS]: [lead('r1', { replied_at: ago(1) }), lead('u2'), lead('x3', { region_blocked: true }), lead('n4', { source_key: 'freight:no:123' }), lead('i5'), lead('d6'), lead('ok7')],
      [MSGS]: [
        msg('r1', 1, 'sent', 6), // replied
        msg('u2', 1, 'sent', 6), // unsubscribed / bounced / complained = suppressed
        msg('x3', 1, 'sent', 6), // region blocked
        msg('n4', 1, 'sent', 6), // non-US freight
        msg('i5', 1, 'sent', 6), msg('i5', 2, 'approved', null), // step 2 already waiting for autosend
        msg('d6', 1, 'sent', 6), msg('d6', 2, 'rejected', null), // a rejected step does not block, it is redrafted
        msg('ok7', 1, 'sent', 3), // too soon
      ],
      calldesk_outreach_suppressions: [{ email: 'u2@broker.co' }],
    });
    const s = await run(db);
    expect(db.inserts.map((i) => `${i.row.lead_id}:${i.row.step}`)).toEqual(['d6:2']);
    expect(s.followUpsCreated).toBe(1);
  });

  it('is idempotent: a second run creates nothing new (the step is in flight)', async () => {
    const db = makeDb({ [LEADS]: [lead('a1')], [MSGS]: [msg('a1', 1, 'sent', 5)] });
    await run(db);
    const second = await run(db);
    expect(db.inserts).toHaveLength(1);
    expect(second.followUpsCreated).toBe(0);
  });

  it('finds due leads past a window full of already-handled ones (the 11-of-175 bug)', async () => {
    const leads: ReturnType<typeof lead>[] = []; const msgs: ReturnType<typeof msg>[] = [];
    // 600 old leads whose whole sequence is done come first by sent_at...
    for (let i = 0; i < 600; i++) { const id = `done${i}`; leads.push(lead(id)); msgs.push(msg(id, 1, 'sent', 40 + i / 100), msg(id, 2, 'sent', 30), msg(id, 3, 'sent', 20)); }
    // ...then 40 genuinely due ones
    for (let i = 0; i < 40; i++) { const id = `due${i}`; leads.push(lead(id)); msgs.push(msg(id, 1, 'sent', 6 + i / 1000)); }
    const db = makeDb({ [LEADS]: leads, [MSGS]: msgs });
    const due = await findDueFollowUps(db as never, freight, NOW, 3, 100);
    expect(due).toHaveLength(40);
    expect(due.every((d) => d.nextStep === 2)).toBe(true);
  });

  it('keeps room: stops staging once ~2 days of approved follow-ups are waiting', async () => {
    process.env.OUTREACH_DAILY_CAP = '10'; // follow-up cap 5 => at most 10 waiting
    const leads = Array.from({ length: 30 }, (_, i) => lead(`l${i}`));
    const msgs = leads.map((l) => msg(l.id as string, 1, 'sent', 6));
    for (let i = 0; i < 8; i++) msgs.push(msg(`w${i}`, 2, 'approved', null));
    const db = makeDb({ [LEADS]: leads, [MSGS]: msgs });
    const s = await run(db);
    expect(s.followUpsCreated).toBe(2); // 10 allowed - 8 waiting
  });

  it('drafts the experiment arm per lead and stores it when the experiment is on', async () => {
    process.env.OUTREACH_FREIGHT_EXPERIMENT = 'on';
    const ids = Array.from({ length: 12 }, (_, i) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`);
    const db = makeDb({ [LEADS]: ids.map((id) => lead(id)), [MSGS]: ids.map((id) => msg(id, 1, 'sent', 5)) });
    process.env.OUTREACH_FOLLOWUP_MAX_PER_RUN = '50';
    await run(db);
    delete process.env.OUTREACH_FOLLOWUP_MAX_PER_RUN;
    expect(db.inserts.length).toBe(12);
    for (const { row } of db.inserts) expect(row.experiment_arm).toBe(pickFreightArm(row.lead_id as string));
    const armsPassed = draftFollowUpEmail.mock.calls.map((c) => (c[0] as { arm: string }).arm);
    expect(new Set(armsPassed).size).toBe(2);
  });

  it('leaves a follow-up that drifts off the offer as a draft even when auto-approve is on', async () => {
    draftFollowUpEmail.mockResolvedValue({ subject: 'Re: x', body: 'Hi there,\n\nStill free for two weeks!\n\nSushanth & Deepika' });
    const db = makeDb({ [LEADS]: [lead('a1')], [MSGS]: [msg('a1', 1, 'sent', 5)] });
    const s = await run(db);
    expect(db.inserts.map((i) => i.row.status)).toEqual(['draft']);
    expect(s.errors.join(' ')).toMatch(/left as draft for review/);
    expect(s.followUpsAutoApproved).toBeUndefined();
  });

  it('dry run drafts and writes nothing, and reports what would be drafted', async () => {
    const db = makeDb({ [LEADS]: [lead('a1'), lead('b2')], [MSGS]: [msg('a1', 1, 'sent', 5), msg('b2', 1, 'sent', 1)] });
    const s = await run(db, summary() as unknown as Summ, true);
    expect(draftFollowUpEmail).not.toHaveBeenCalled();
    expect(db.inserts).toEqual([]);
    expect(s.followUpPlan).toEqual([{ company: 'Broker a1', step: 2, arm: null, autoApprove: true }]);
  });

  it('OUTREACH_MAX_FOLLOWUPS=0 turns the whole stage off', async () => {
    process.env.OUTREACH_MAX_FOLLOWUPS = '0';
    const db = makeDb({ [LEADS]: [lead('a1')], [MSGS]: [msg('a1', 1, 'sent', 5)] });
    await run(db);
    expect(db.inserts).toEqual([]);
  });
});

describe('stageDraft (freight first emails)', () => {
  const fresh = (id: string, extra: Record<string, unknown> = {}) => ({ id, company_name: `Broker ${id}`, domain: null, tier: null, location: 'Cole Camp, MO', description: 'd', status: 'new', contact_status: 'found', region_blocked: false, score: 60, contact_email: `${id}@broker.co`, source_key: 'freight:mc:100', signals: {}, product: 'calldesk:freight', research: null, ...extra });
  beforeEach(() => { draftAgencyEmail.mockReset(); draftAgencyEmail.mockResolvedValue({ subject: 'S', body: 'B' }); });

  it('never drafts non-US freight leads, whatever their stored state', async () => {
    const db = makeDb({
      [LEADS]: [fresh('us1'), fresh('no2', { source_key: 'freight:no:912345678', location: 'Oslo' }), fresh('uk3', { source_key: 'freight:gb-dvsa:OB1', location: 'Leeds' }), fresh('rel4', { source_key: 'freight:no:5', signals: { intlHold: { country: 'NO' } } })],
      [MSGS]: [], calldesk_outreach_suppressions: [],
    });
    const s = { draftsCreated: 0, errors: [] as string[] };
    await stageDraft(db as never, s as never, false, 10, () => false, false, freight);
    expect(db.inserts.map((i) => i.row.lead_id)).toEqual(['us1']);
    expect(s.draftsCreated).toBe(1);
  });

  it('assigns the arm only when the experiment is on, stores it in experiment_arm (not variant), and drafts under that arm', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`);
    const mk = () => makeDb({ [LEADS]: ids.map((id) => fresh(id)), [MSGS]: [], calldesk_outreach_suppressions: [] });
    const off = mk();
    await stageDraft(off as never, { draftsCreated: 0, errors: [] } as never, false, 20, () => false, false, freight);
    expect(off.inserts.every((i) => !('experiment_arm' in i.row) && !('variant' in i.row))).toBe(true);
    expect(draftAgencyEmail.mock.calls.every((c) => (c[0] as { arm: unknown }).arm === null)).toBe(true);

    process.env.OUTREACH_FREIGHT_EXPERIMENT = 'on';
    draftAgencyEmail.mockClear();
    const on = mk();
    await stageDraft(on as never, { draftsCreated: 0, errors: [] } as never, false, 20, () => false, false, freight);
    for (const { row } of on.inserts) { expect(row.experiment_arm).toBe(pickFreightArm(row.lead_id as string)); expect('variant' in row).toBe(false); }
    expect(new Set(on.inserts.map((i) => i.row.experiment_arm))).toEqual(new Set(['free_week', 'demo']));
    const byLead = Object.fromEntries(draftAgencyEmail.mock.calls.map((c) => [(c[0] as { name: string }).name, (c[0] as { arm: string }).arm]));
    expect(byLead[`Broker ${ids[0]}`]).toBe(pickFreightArm(ids[0]));
  });

  it('does not set an arm for other verticals even with the experiment on', async () => {
    process.env.OUTREACH_FREIGHT_EXPERIMENT = 'on';
    const db = makeDb({ [LEADS]: [fresh('d1', { product: 'calldesk:dental', source_key: 'dental:x' })], [MSGS]: [], calldesk_outreach_suppressions: [] });
    await stageDraft(db as never, { draftsCreated: 0, errors: [] } as never, false, 5, () => false, false, dental);
    expect(db.inserts).toHaveLength(1);
    expect('experiment_arm' in db.inserts[0].row).toBe(false);
  });
});
