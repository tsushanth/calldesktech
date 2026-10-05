import { describe, it, expect } from 'vitest';
import { callFromOptions, friendlyCallError } from '@/lib/testCallNumbers';

const nums = [
  { id: 'a', number: '+16506755852', outbound_agent_version_id: null },
  { id: 'b', number: '+12245061194', outbound_agent_version_id: 'v1' },
  { id: 'c', number: '+14155558888', outbound_agent_version_id: 'other' },
];

describe('callFromOptions', () => {
  it('offers every number, ready ones first, and labels the rest', () => {
    const o = callFromOptions(nums, 'v1', 1);
    expect(o.map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(o[0]).toMatchObject({ ready: true, label: '+12245061194' });
    expect(o[1]).toMatchObject({ ready: false, label: '+16506755852 (not using V1 yet)' });
  });
  it('marks nothing ready when there is no published version', () => {
    expect(callFromOptions(nums, null, null).every((x) => !x.ready)).toBe(true);
  });
  it('returns an empty list for a workspace with no numbers', () => {
    expect(callFromOptions([], 'v1', 1)).toEqual([]);
  });
});

describe('friendlyCallError', () => {
  it("replaces the carrier's unverified-number error with a plain instruction", () => {
    const raw = "Twilio: The source phone number provided, +16506755852, is not yet verified for your account. You may only make calls from phone numbers that you've verified or purchased from Twilio.";
    const out = friendlyCallError(raw);
    expect(out).toMatch(/can't place calls from this number/);
    expect(out).toMatch(/Phone Numbers page/);
    expect(out).not.toMatch(/Twilio/);
  });
  it('passes other errors through unchanged', () => {
    expect(friendlyCallError('Too many test calls, try again in a minute')).toBe('Too many test calls, try again in a minute');
  });
});
