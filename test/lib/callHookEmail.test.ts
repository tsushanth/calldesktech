import { describe, expect, it } from 'vitest';
import { buildCallHookEmail, localCallTime, timezoneForState } from '@/lib/outreach/callHookEmail';

const T = new Date('2026-10-05T16:42:00Z'); // 11:42 am Central, 9:42 am Pacific

describe('timezoneForState / localCallTime', () => {
  it('maps states and formats the lead local time', () => {
    expect(timezoneForState('tx')).toBe('America/Chicago'); expect(timezoneForState('ZZ')).toBeNull(); expect(timezoneForState(null)).toBeNull();
    expect(localCallTime(T, 'TX')).toBe('11:42 am Central');
    expect(localCallTime(T, 'CA')).toBe('9:42 am Pacific');
    expect(localCallTime(T, 'NY')).toBe('12:42 pm Eastern');
    expect(localCallTime(T, null)).toBeNull();
  });
});

describe('buildCallHookEmail', () => {
  it('states the real call time and outcome, in freight wording', () => {
    const e = buildCallHookEmail({ company: 'Dynamico Transport LLC', product: 'calldesk:freight', outcome: 'voicemail', calledAt: T, state: 'TX' });
    expect(e.subject).toBe('We tried calling Dynamico Transport LLC today');
    expect(e.body).toContain('at 11:42 am Central today and it went to voicemail');
    expect(e.body).toContain('MC number'); expect(e.body).toContain('free test line'); expect(e.body).toContain('no credit card');
  });
  it('says nobody picked up for a no-answer, and drops the time when the state is unknown', () => {
    const e = buildCallHookEmail({ company: 'Acme', product: 'calldesk:towing', outcome: 'no_answer', calledAt: T, state: null });
    expect(e.body).toContain('We tried calling Acme today and nobody picked up');
    expect(e.body).not.toContain('MC number');
  });
  it('is ASCII only, never claims to be a person calling, and never says "not selling"', () => {
    const e = buildCallHookEmail({ company: 'Café — Freight', product: 'calldesk:freight', outcome: 'no_answer', calledAt: T, state: 'TX' });
    expect(/^[\x20-\x7E\n]*$/.test(e.subject + e.body)).toBe(true);
    expect(e.body).not.toMatch(/not selling|not trying to sell/i);
  });
});
