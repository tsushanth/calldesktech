import { describe, it, expect } from 'vitest';
import {
  detectCallIssues, detectClaimedBookingWithoutTool, detectPlaceholderReadAloud, detectNumberReadbackMismatch, detectNoFieldsCollected,
  detectLongSilence, extractDigitRuns, summarizeIssues, issuesFromAnalysis, backfillCallIssues, detectAndStoreCallIssues, normalizeTranscript,
} from '@/lib/callIssues';
import { makeFakeDb } from '../helpers/fakePilotDb';

const T = (...pairs: Array<['u' | 'a', string]>) => pairs.map(([r, c]) => ({ role: r === 'u' ? 'user' : 'assistant', content: c }));

const bookingCall = T(
  ['a', 'Thanks for calling Bright Smile Dental, this is Sam. How can I help?'],
  ['u', "Hi, I'd like to book a cleaning for Thursday afternoon."],
  ['a', 'Sure. What time works for you on Thursday?'],
  ['u', 'Around 3 PM?'],
  ['a', "3 PM is available. I've booked your cleaning for Thursday at 3 PM. You're all set for Thursday at 3."],
  ['u', 'Great, thanks.'],
);

describe('claimed_booking_without_tool', () => {
  it('flags a confirmed time when the tenant had no calendar', () => {
    const i = detectClaimedBookingWithoutTool({ transcript: bookingCall, bookingToolsAvailable: false });
    expect(i?.code).toBe('claimed_booking_without_tool');
    expect(i?.severity).toBe('high');
    expect(i?.evidence.join(' ')).toMatch(/booked your cleaning/);
    expect(i?.fix).toMatch(/Connect a calendar/);
  });
  it('does not flag when the booking tools were available and use is not recorded', () => {
    expect(detectClaimedBookingWithoutTool({ transcript: bookingCall, bookingToolsAvailable: true })).toBeNull();
    expect(detectClaimedBookingWithoutTool({ transcript: bookingCall })).toBeNull();
  });
  it('flags when tool calls are recorded and none was a booking tool', () => {
    expect(detectClaimedBookingWithoutTool({ transcript: bookingCall, bookingToolsAvailable: true, toolCalls: ['record_field'] })?.code).toBe('claimed_booking_without_tool');
    expect(detectClaimedBookingWithoutTool({ transcript: bookingCall, bookingToolsAvailable: true, toolCalls: ['check_availability', 'book_appointment'] })).toBeNull();
  });
  it('does not flag an agent that takes a request and says someone will confirm', () => {
    const t = T(
      ['u', 'Can I get an appointment Thursday at 3?'],
      ['a', "I can't book that myself, but I've taken your request for Thursday at 3 PM. Someone will call you to confirm."],
      ['a', 'Does Thursday at 3 PM work for you?'],
      ['a', 'If that time is available, our team will confirm it by text.'],
    );
    expect(detectClaimedBookingWithoutTool({ transcript: t, bookingToolsAvailable: false })).toBeNull();
  });
  it('does not flag a generic sign-off', () => {
    const t = T(['u', 'That is all.'], ['a', "You're all set. Thanks for calling, have a great day!"]);
    expect(detectClaimedBookingWithoutTool({ transcript: t, bookingToolsAvailable: false })).toBeNull();
  });
  it('ignores caller speech', () => {
    const t = T(['u', "I've booked it already, the appointment is confirmed"], ['a', 'Okay, how can I help?']);
    expect(detectClaimedBookingWithoutTool({ transcript: t, bookingToolsAvailable: false })).toBeNull();
  });
  it('flags "we have an opening at"', () => {
    const t = T(['u', 'Anything tomorrow?'], ['a', 'Yes, we have an opening at 10 AM tomorrow.']);
    expect(detectClaimedBookingWithoutTool({ transcript: t, bookingToolsAvailable: false })?.code).toBe('claimed_booking_without_tool');
  });
});

describe('placeholder_read_aloud', () => {
  it.each([
    'Hi, this is [Your Name] from [Company].',
    'Welcome to {{business_name}}, how can I help?',
    'Thanks for calling <company name>.',
    'Please insert your name here and we will begin.',
    'Hello [INSERT DATE], this is a reminder.',
  ])('flags %s', (text) => {
    const i = detectPlaceholderReadAloud({ transcript: T(['a', text]) });
    expect(i?.code).toBe('placeholder_read_aloud');
    expect(i?.severity).toBe('medium');
  });
  it('does not flag normal speech, SSML, tone tags or caller text', () => {
    expect(detectPlaceholderReadAloud({ transcript: T(['a', 'Thanks for calling Acme. <break time="1s"/> How can I help?']) })).toBeNull();
    expect(detectPlaceholderReadAloud({ transcript: T(['a', '[laughs] Sorry, that was funny.']) })).toBeNull();
    expect(detectPlaceholderReadAloud({ transcript: T(['u', 'My name is [Your Name] lol']) })).toBeNull();
    expect(detectPlaceholderReadAloud({ transcript: T(['a', 'It costs less than 5 dollars, or more than 3.']) })).toBeNull();
  });
});

describe('extractDigitRuns', () => {
  it('reads numerals, spelled digits and separators', () => {
    expect(extractDigitRuns('five five five, 0 1 4 7')[0].digits).toBe('55501 47'.replace(' ', ''));
    expect(extractDigitRuns('415-555-0147')[0].digits).toBe('4155550147');
    expect(extractDigitRuns('four one five five five five oh one four seven')[0].digits).toBe('4155550147');
  });
  it('handles double/triple and ignores an edge "oh"', () => {
    expect(extractDigitRuns('double five oh one')[0]).toEqual({ digits: '5501', hadMultiplier: true });
    expect(extractDigitRuns('oh five five five')[0].digits).toBe('555');
    expect(extractDigitRuns('I have two dogs')[0].digits).toBe('2');
  });
});

describe('number_readback_mismatch', () => {
  it('flags a read-back with a dropped digit', () => {
    const t = T(
      ['a', 'What is the best number to reach you?'],
      ['u', 'Sure, it is 4 1 5 5 5 5 0 1 4 7.'],
      ['a', "Got it, that's 4 1 5, 5 5 5, 0 1 4. Is that right?"],
      ['u', 'Yeah ok'],
    );
    const i = detectNumberReadbackMismatch({ transcript: t });
    expect(i?.code).toBe('number_readback_mismatch');
    expect(i?.message).toMatch(/10 digits but the agent read back 9/);
  });
  it('flags a repeated-digit count error (555 read as 55)', () => {
    const t = T(['u', 'four one five five five five zero one four seven'], ['a', "Thanks. So that's four one five, five five, zero one four seven, correct?"]);
    expect(detectNumberReadbackMismatch({ transcript: t })?.code).toBe('number_readback_mismatch');
  });
  it('does not flag a correct read-back in other formatting', () => {
    const t = T(['u', 'My number is 4155550147'], ['a', "Let me confirm: four one five, five five five, zero one four seven. Is that right?"]);
    expect(detectNumberReadbackMismatch({ transcript: t })).toBeNull();
  });
  it('does not flag when the agent adds an area code', () => {
    const t = T(['u', 'It is 555 0147'], ['a', "So that's 415 555 0147, correct?"]);
    expect(detectNumberReadbackMismatch({ transcript: t })).toBeNull();
  });
  it('does not flag when the caller corrects and the second read-back is right', () => {
    const t = T(
      ['u', '4 1 5 5 5 5 0 1 4 7'], ['a', "That's 4 1 5 5 5 5 0 1 4, right?"],
      ['u', 'No, 4 1 5 5 5 5 0 1 4 7'], ['a', "Sorry, that's 4 1 5 5 5 5 0 1 4 7. Is that right?"],
    );
    expect(detectNumberReadbackMismatch({ transcript: t })).toBeNull();
  });
  it('ignores short digit strings, double/triple callers, and unrelated numbers the agent states', () => {
    expect(detectNumberReadbackMismatch({ transcript: T(['u', 'my zip is 94035'], ['a', 'Got it, 94045?']) })).toBeNull();
    expect(detectNumberReadbackMismatch({ transcript: T(['u', 'four one five double five zero one four seven'], ['a', "That's 4 1 5 5 0 1 4 7"]) })).toBeNull();
    expect(detectNumberReadbackMismatch({ transcript: T(['u', 'call me on 4155550147 please'], ['a', 'Our office line is 6505551234 if you need us.']) })).toBeNull();
  });
});

describe('no_fields_collected', () => {
  const base = { transcript: [], durationSeconds: 95, expectsFields: true };
  it('flags a recorded-empty extraction on a long call', () => {
    expect(detectNoFieldsCollected({ ...base, extractedData: {} })?.code).toBe('no_fields_collected');
  });
  it('is silent when fields were collected, the call was short, or collection is not recorded', () => {
    expect(detectNoFieldsCollected({ ...base, extractedData: { name: 'Pat' } })).toBeNull();
    expect(detectNoFieldsCollected({ ...base, durationSeconds: 25, extractedData: {} })).toBeNull();
    expect(detectNoFieldsCollected({ ...base, extractedData: null })).toBeNull();
    expect(detectNoFieldsCollected({ ...base, expectsFields: false, extractedData: {} })).toBeNull();
  });
});

describe('long_silence', () => {
  it('skips transcripts without timestamps', () => {
    expect(detectLongSilence({ transcript: T(['a', 'Hello'], ['u', 'Hi']) })).toBeNull();
  });
  it('flags a gap of 12s or more when timestamps exist', () => {
    const t = [{ role: 'assistant', content: 'One moment', timestamp: 100 }, { role: 'user', content: 'hello?', timestamp: 118 }];
    expect(detectLongSilence({ transcript: t })?.severity).toBe('low');
  });
});

describe('detectCallIssues', () => {
  it('returns several issues for one call', () => {
    const t = [...bookingCall, ...T(['a', 'Welcome to [Company]!'])];
    const codes = detectCallIssues({ transcript: t, durationSeconds: 80, bookingToolsAvailable: false }).map((i) => i.code);
    expect(codes).toEqual(['claimed_booking_without_tool', 'placeholder_read_aloud']);
  });
  it('skips blocked pilot calls, internal tests and calls under 15 seconds', () => {
    const base = { transcript: bookingCall, bookingToolsAvailable: false as const };
    expect(detectCallIssues({ ...base, durationSeconds: 60, analysis: { blocked: 'pilot' } })).toEqual([]);
    expect(detectCallIssues({ ...base, durationSeconds: 60, isInternalTest: true })).toEqual([]);
    expect(detectCallIssues({ ...base, durationSeconds: 10 })).toEqual([]);
    expect(detectCallIssues({ ...base, durationSeconds: 60 }).length).toBe(1);
  });
  it('yields nothing for a Retell blob transcript or garbage input', () => {
    expect(detectCallIssues({ transcript: [{ role: 'system', content: 'Agent: I booked you' }], bookingToolsAvailable: false })).toEqual([]);
    expect(detectCallIssues({ transcript: null })).toEqual([]);
    expect(normalizeTranscript('text')).toEqual([]);
  });
});

describe('summarizeIssues', () => {
  const issue = (code: string, severity = 'high') => ({ code, severity, message: 'm', evidence: [], fix: 'f' });
  it('counts by code and agent and excludes blocked and internal calls', () => {
    const s = summarizeIssues([
      { analysis: { issues: [issue('claimed_booking_without_tool'), issue('placeholder_read_aloud', 'medium')] }, agentKey: 'a1' },
      { analysis: { issues: [issue('claimed_booking_without_tool')] }, agentKey: 'a1' },
      { analysis: { issues: [issue('claimed_booking_without_tool')] }, agentKey: 'a2', is_internal_test: true },
      { analysis: { blocked: 'pilot', issues: [issue('placeholder_read_aloud')] }, agentKey: 'a2' },
      { analysis: { issues: [] }, agentKey: 'a2' },
    ]);
    expect(s.callsWithIssues).toBe(2);
    expect(s.byCode[0]).toMatchObject({ code: 'claimed_booking_without_tool', count: 2 });
    expect(s.agentCounts).toEqual([{ agentKey: 'a1', calls: 2, issues: 3 }]);
    expect(issuesFromAnalysis(null)).toEqual([]);
  });
});

describe('storage and backfill', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  const row = (over: Record<string, unknown>) => ({
    id: 'c1', tenant_id: 't1', retell_call_id: 'CA1', to_number: null, direction: 'inbound', created_at: '2026-10-03T12:00:00Z',
    duration_seconds: 80, transcript: bookingCall, extracted_data: null, analysis: { built_in: { call_summary: 'x' }, expert_backup: { escalations: 1 } }, is_internal_test: false, ...over,
  });
  it('stores issues next to existing analysis keys, never overwriting them', async () => {
    const db = makeFakeDb({ calldesk_call_logs: [row({})] });
    const issues = await detectAndStoreCallIssues(db as never, row({}));
    expect(issues?.map((i) => i.code)).toEqual(['claimed_booking_without_tool']); // no calendar connection row -> tools unavailable
    const stored = (db.tables.calldesk_call_logs[0].analysis as Record<string, unknown>);
    expect(stored.built_in).toEqual({ call_summary: 'x' });
    expect(stored.expert_backup).toEqual({ escalations: 1 });
    expect(Array.isArray(stored.issues)).toBe(true);
  });
  it('treats a calendar connected after the call as not available at call time, and one before as available', async () => {
    const before = makeFakeDb({ calldesk_call_logs: [row({})], calldesk_calendar_connections: [{ tenant_id: 't1', created_at: '2026-09-01T00:00:00Z' }] });
    expect(await detectAndStoreCallIssues(before as never, row({}))).toEqual([]);
    const after = makeFakeDb({ calldesk_call_logs: [row({})], calldesk_calendar_connections: [{ tenant_id: 't1', created_at: '2026-10-04T00:00:00Z' }] });
    expect((await detectAndStoreCallIssues(after as never, row({})))?.length).toBe(1);
  });
  it('dry run writes nothing', async () => {
    const db = makeFakeDb({ calldesk_call_logs: [row({})] });
    await detectAndStoreCallIssues(db as never, row({}), { dry: true });
    expect(db.writes.length).toBe(0);
  });
  it('never throws on a broken client', async () => {
    const broken = { from: () => { throw new Error('boom'); } };
    expect(await detectAndStoreCallIssues(broken as never, row({}))).toBeNull();
  });
  it('backfill builds its query for 14 days, limit 200, no internal tests', async () => {
    const calls: Array<[string, unknown[]]> = [];
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'gte', 'lte', 'not', 'neq', 'is', 'order', 'limit']) chain[m] = (...a: unknown[]) => { calls.push([m, a]); return m === 'limit' ? Promise.resolve({ data: [], error: null }) : chain; };
    const res = await backfillCallIssues({ from: () => chain } as never, { now, limit: 999, dry: true });
    expect(res).toMatchObject({ scanned: 0, dry: true });
    expect(calls.find((c) => c[0] === 'limit')![1]).toEqual([200]);
    expect(calls.find((c) => c[0] === 'gte')![1][1]).toBe('2026-09-20T12:00:00.000Z');
    expect(calls.find((c) => c[0] === 'is')![1]).toEqual(['analysis->issues', null]);
    expect(calls.find((c) => c[0] === 'neq')![1]).toEqual(['is_internal_test', true]);
  });
});
