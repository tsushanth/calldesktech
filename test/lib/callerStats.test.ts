import { describe, it, expect } from 'vitest';
import { aggregate, segmentLabel, type BatchRow, type CallRow } from '@/lib/callerStats';

const b = (over: Partial<BatchRow>): BatchRow => ({ batch_date: '2026-10-06', sip_username: 'mark', phone: '+12145550100', outcome: null, notes: null, lead_id: 'L1', ...over });
const c = (over: Partial<CallRow>): CallRow => ({ sip_username: 'mark', to_number: '+12145550100', status: 'completed', answered: false, duration_seconds: 0, started_at: '2026-10-06T15:05:00Z', outcome: null, ...over });

describe('segmentLabel', () => {
  it('names the products', () => {
    expect(segmentLabel('calldesk')).toBe('Resellers and agencies');
    expect(segmentLabel('calldesk:freight')).toBe('Freight');
    expect(segmentLabel(null)).toBe('Unknown');
  });
});

describe('aggregate', () => {
  const products = new Map([['L1', 'calldesk:freight'], ['L2', 'calldesk']]);
  it('counts outcomes, people reached and decision makers', () => {
    const batch = [
      b({ phone: '+1', outcome: 'gatekeeper', notes: '[dm:no]' }),
      b({ phone: '+2', outcome: 'not_interested', notes: '[dm:yes][reason:has_staff]' }),
      b({ phone: '+3', outcome: 'voicemail' }),
      b({ phone: '+4', outcome: 'no_answer' }),
      b({ phone: '+5', outcome: 'callback_requested', notes: '[dm:yes]' }),
      b({ phone: '+6' }),
    ];
    const { days } = aggregate(batch, [], products);
    expect(days[0]).toMatchObject({ numbers: 6, logged: 5, gatekeeper: 1, voicemail: 1, no_answer: 1, not_interested: 1, people_reached: 3, decision_maker: 2, wins: 1 });
  });
  it('counts dials and connects, ignores blocked dials and test calls, averages talk time', () => {
    const calls = [
      c({ answered: true, duration_seconds: 60 }),
      c({ answered: true, duration_seconds: 30 }),
      c({ answered: false }),
      c({ status: 'rejected' }),
      c({ outcome: 'test', answered: true, duration_seconds: 500 }),
    ];
    const { days } = aggregate([], calls, products);
    expect(days[0]).toMatchObject({ dials: 3, connected: 2, avg_talk_seconds: 45 });
  });
  it('splits by segment through the lead of each number', () => {
    const batch = [b({ phone: '+1', lead_id: 'L1', outcome: 'voicemail' }), b({ phone: '+2', lead_id: 'L2', outcome: 'gatekeeper', notes: '[dm:no]' })];
    const calls = [c({ to_number: '+1', answered: true, duration_seconds: 10 }), c({ to_number: '+2' })];
    const { segments } = aggregate(batch, calls, products);
    const byName = Object.fromEntries(segments.map((s) => [s.label, s]));
    expect(byName['Freight']).toMatchObject({ numbers: 1, dials: 1, connected: 1, voicemail: 1 });
    expect(byName['Resellers and agencies']).toMatchObject({ numbers: 1, dials: 1, gatekeeper: 1 });
  });
  it('buckets dials by Eastern hour', () => {
    const { hours } = aggregate([], [c({ started_at: '2026-10-06T15:05:00Z', answered: true }), c({ started_at: '2026-10-06T15:40:00Z' }), c({ started_at: '2026-10-06T18:00:00Z' })], products);
    expect(hours).toEqual([{ hour: 11, dials: 2, connected: 1 }, { hour: 14, dials: 1, connected: 0 }]);
  });
});
