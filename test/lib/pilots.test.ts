import { describe, it, expect } from 'vitest';
import {
  computePilotStats, computeAlertEvents, topSummaryTopics, summaryKeywords, isFailedCall, isShortCall, callSentiment,
  type PilotRow, type PilotCall,
} from '@/lib/pilots';

const START = '2026-10-05T16:00:00.000Z';
const at = (h: number) => new Date(Date.parse(START) + h * 3600_000);
const pilot = (over: Partial<PilotRow> = {}): PilotRow => ({
  id: 'p1', tenant_id: 't1', contact_name: 'Dana', contact_email: 'dana@example.com', company: 'Acme Dental', vertical: 'dental',
  started_at: START, ends_at: new Date(Date.parse(START) + 7 * 86400_000).toISOString(), minutes_cap: 50, status: 'active', notes: null, created_at: START, ...over,
});
let n = 0;
const call = (hoursIn: number, secs: number, outcome: string | null, analysis: Record<string, unknown> | null = null, extra: Partial<PilotCall> = {}): PilotCall => ({
  id: `c${++n}`, created_at: at(hoursIn).toISOString(), duration_seconds: secs, outcome, analysis, ...extra,
});

describe('computePilotStats', () => {
  it('handles a pilot with no calls', () => {
    const s = computePilotStats(pilot(), [], at(2));
    expect(s.calls).toBe(0);
    expect(s.minutesUsed).toBe(0);
    expect(s.minutesRemaining).toBe(50);
    expect(s.percentOfCap).toBe(0);
    expect(s.lastCallAt).toBeNull();
    expect(s.nextAction.code).toBe('wait_for_calls');
    expect(s.daysLeft).toBe(7);
    expect(s.blocked).toBe(false);
  });

  it('recommends checking forwarding after 24h with no calls', () => {
    const s = computePilotStats(pilot(), [], at(25));
    expect(s.nextAction.code).toBe('check_forwarding');
    expect(s.nextAction.urgent).toBe(true);
  });

  it('sums minutes, outcomes, sentiment, last call and top summaries', () => {
    const calls = [
      call(1, 120, 'booked', { call_summary: 'Wants to book a cleaning', user_sentiment: 'Positive', call_successful: true }),
      call(2, 300, 'answered', { call_summary: 'Asked about insurance', user_sentiment: 'Neutral' }),
      call(3, 60, 'transferred', { user_sentiment: 'Negative', call_summary: 'Angry about billing' }),
      call(4, 30, 'abandoned'),
    ];
    const s = computePilotStats(pilot(), calls, at(10));
    expect(s.calls).toBe(4);
    expect(s.secondsUsed).toBe(510);
    expect(s.minutesUsed).toBe(8.5);
    expect(s.minutesRemaining).toBe(41.5);
    expect(s.percentOfCap).toBe(17);
    expect(s.outcomes).toEqual({ booked: 1, answered: 1, transferred: 1, abandoned: 1 });
    expect(s.sentiment).toEqual({ positive: 1, neutral: 1, negative: 1, unknown: 1 });
    expect(s.lastCallAt).toBe(at(4).toISOString());
    expect(s.topSummaries.map((x) => x.summary)).toEqual(['Angry about billing', 'Asked about insurance', 'Wants to book a cleaning']);
    expect(s.notableCalls.find((x) => x.reason === 'negative')?.summary).toBe('Angry about billing');
    expect(s.notableCalls.find((x) => x.reason === 'long')).toBeTruthy();
  });

  it('counts failed and very short calls, and ignores abandoned as a failure', () => {
    const calls = [
      call(1, 45, 'answered', { call_successful: false }),
      call(1, 45, 'failed'),
      call(1, 4, 'abandoned'),
      call(1, 45, 'abandoned'),
      call(1, 90, 'answered', { call_successful: 'false' }),
    ];
    const s = computePilotStats(pilot(), calls, at(5));
    expect(s.failedCalls).toBe(3);
    expect(s.shortCalls).toBe(1);
    expect(s.nextAction.code).toBe('review_failures');
  });

  it('excludes internal test calls and calls before the pilot started', () => {
    const calls = [call(1, 600, 'answered', null, { is_internal_test: true }), call(-3, 600, 'answered'), call(1, 60, 'answered')];
    const s = computePilotStats(pilot(), calls, at(5));
    expect(s.calls).toBe(1);
    expect(s.minutesUsed).toBe(1);
  });

  it('flags near cap at 80% and blocks at 100%', () => {
    const s80 = computePilotStats(pilot(), [call(1, 2400, 'answered')], at(5));
    expect(s80.percentOfCap).toBe(80);
    expect(s80.nextAction.code).toBe('near_cap');
    expect(s80.blocked).toBe(false);

    const s100 = computePilotStats(pilot(), [call(1, 3000, 'answered')], at(5));
    expect(s100.effectiveStatus).toBe('capped');
    expect(s100.minutesRemaining).toBe(0);
    expect(s100.blocked).toBe(true);
    expect(s100.blockReason).toBe('cap');
    expect(s100.nextAction.code).toBe('cap_reached_convert');
  });

  it('over the cap never shows negative minutes remaining', () => {
    const s = computePilotStats(pilot(), [call(1, 4000, 'answered')], at(5));
    expect(s.minutesRemaining).toBe(0);
    expect(s.percentOfCap).toBeGreaterThan(100);
  });

  it('expires after ends_at and blocks', () => {
    const s = computePilotStats(pilot(), [call(1, 120, 'answered')], at(24 * 7 + 1));
    expect(s.effectiveStatus).toBe('expired');
    expect(s.blocked).toBe(true);
    expect(s.blockReason).toBe('expired');
    expect(s.daysLeft).toBe(0);
    expect(s.nextAction.code).toBe('ended_convert');
    expect(computePilotStats(pilot(), [], at(24 * 7 + 1)).nextAction.code).toBe('ended_no_calls');
  });

  it('offers a follow-up call near the end of a healthy pilot', () => {
    const s = computePilotStats(pilot(), [call(1, 300, 'booked')], at(24 * 5 + 1));
    expect(s.daysLeft).toBe(2);
    expect(s.nextAction.label).toBe('Offer follow-up call');
    expect(s.followUpBy).toBe(at(24 * 5).toISOString());
  });

  it('stopped and converted keep their status and converted is never blocked', () => {
    const stopped = computePilotStats(pilot({ status: 'stopped' }), [], at(5));
    expect(stopped.effectiveStatus).toBe('stopped');
    expect(stopped.blocked).toBe(true);
    expect(stopped.blockReason).toBe('stopped');
    const conv = computePilotStats(pilot({ status: 'converted' }), [call(1, 9999, 'answered')], at(24 * 30));
    expect(conv.effectiveStatus).toBe('converted');
    expect(conv.blocked).toBe(false);
  });

  it('a capped pilot returns to active when the cap is raised', () => {
    const calls = [call(1, 3000, 'answered')];
    expect(computePilotStats(pilot({ status: 'capped' }), calls, at(5)).effectiveStatus).toBe('capped');
    const s = computePilotStats(pilot({ status: 'capped', minutes_cap: 75 }), calls, at(5));
    expect(s.effectiveStatus).toBe('active');
    expect(s.blocked).toBe(false);
  });

  it('tolerates null durations and odd analysis shapes', () => {
    const s = computePilotStats(pilot(), [call(1, 0, null, { call_summary: 42 }), { ...call(1, 0, 'answered'), duration_seconds: null }], at(5));
    expect(s.calls).toBe(2);
    expect(s.minutesUsed).toBe(0);
    expect(s.topSummaries).toEqual([]);
    expect(s.outcomes.unknown).toBe(1);
  });
});

describe('predicates', () => {
  it('classify failure, short and sentiment', () => {
    expect(isFailedCall({ outcome: 'answered', analysis: { call_successful: false } })).toBe(true);
    expect(isFailedCall({ outcome: 'answered', analysis: { call_successful: true } })).toBe(false);
    expect(isFailedCall({ outcome: 'abandoned', analysis: null })).toBe(false);
    expect(isShortCall({ duration_seconds: 9 })).toBe(true);
    expect(isShortCall({ duration_seconds: 10 })).toBe(false);
    expect(isShortCall({ duration_seconds: null })).toBe(true);
    expect(callSentiment({ analysis: { user_sentiment: ' NEGATIVE ' } })).toBe('negative');
    expect(callSentiment({ analysis: { user_sentiment: 'Unknown' } })).toBe('unknown');
  });
});

describe('computeAlertEvents', () => {
  const kinds = (evs: ReturnType<typeof computeAlertEvents>) => evs.map((e) => e.kind).sort();

  it('raises nothing for a healthy pilot', () => {
    expect(computeAlertEvents(pilot(), [call(1, 300, 'answered')], at(5))).toEqual([]);
  });
  it('raises cap_80 then cap_100 exclusively', () => {
    expect(kinds(computeAlertEvents(pilot(), [call(1, 2500, 'answered')], at(5)))).toEqual(['cap_80']);
    expect(kinds(computeAlertEvents(pilot(), [call(1, 3100, 'answered')], at(5)))).toEqual(['cap_100']);
  });
  it('raises no_calls_24h only after 24h and while running', () => {
    expect(computeAlertEvents(pilot(), [], at(23))).toEqual([]);
    expect(kinds(computeAlertEvents(pilot(), [], at(25)))).toEqual(['no_calls_24h']);
    expect(computeAlertEvents(pilot(), [], at(24 * 8))).toEqual([]);
  });
  it('raises expiring_24h inside the last day', () => {
    expect(kinds(computeAlertEvents(pilot(), [call(1, 300, 'answered')], at(24 * 6 + 2)))).toEqual(['expiring_24h']);
    expect(computeAlertEvents(pilot(), [call(1, 300, 'answered')], at(24 * 5))).toEqual([]);
  });
  it('raises one event per failed or short call, keyed by call id', () => {
    const a = call(1, 60, 'answered', { call_successful: false });
    const b = call(1, 3, 'abandoned');
    const evs = computeAlertEvents(pilot(), [a, b, call(1, 300, 'answered')], at(5));
    expect(evs.map((e) => e.key).sort()).toEqual([`p1:failed_call:${a.id}`, `p1:short_call:${b.id}`].sort());
  });
  it('stopped and converted pilots raise nothing', () => {
    expect(computeAlertEvents(pilot({ status: 'stopped' }), [], at(30))).toEqual([]);
    expect(computeAlertEvents(pilot({ status: 'converted' }), [], at(30))).toEqual([]);
  });
});

describe('topics', () => {
  it('extracts content words once per summary', () => {
    expect(summaryKeywords('The caller asked about pricing and pricing plans!')).toEqual(['pricing', 'plans']);
  });
  it('counts words across summaries deterministically and applies minCount', () => {
    const s = ['Asked about insurance coverage', 'Wants insurance pricing', 'Insurance question, hours', 'Opening hours question'];
    expect(topSummaryTopics(s)).toEqual([
      { topic: 'insurance', count: 3 },
      { topic: 'hours', count: 2 },
      { topic: 'question', count: 2 },
    ]);
    expect(topSummaryTopics(s, 1)).toEqual([{ topic: 'insurance', count: 3 }]);
    expect(topSummaryTopics([])).toEqual([]);
  });
});

describe('blocked calls', () => {
  it('calls the engine turned away count for nothing', () => {
    const calls = [call(1, 600, 'answered'), call(1, 6, 'abandoned', { blocked: 'pilot' })];
    const s = computePilotStats(pilot(), calls, at(5));
    expect(s.calls).toBe(1);
    expect(s.shortCalls).toBe(0);
    expect(computeAlertEvents(pilot(), calls, at(5))).toEqual([]);
  });
});
