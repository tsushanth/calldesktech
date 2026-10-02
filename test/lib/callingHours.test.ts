import { describe, it, expect } from 'vitest';
import { stateFromLocation, checkCallingHours, localTimeLabel } from '@/lib/callingHours';

// 2026-10-05 is a Monday; October is daylight time (Eastern = UTC-4, Central = UTC-5, Pacific = UTC-7).
const at = (iso: string) => new Date(iso);

describe('stateFromLocation', () => {
  it('reads a US state from "City, ST" and ignores non-US', () => {
    expect(stateFromLocation('Fort Myers, FL')).toBe('FL');
    expect(stateFromLocation('Austin, TX 78731')).toBe('TX');
    expect(stateFromLocation('Spydeberg, NO')).toBeNull();
    expect(stateFromLocation('')).toBeNull();
    expect(stateFromLocation(null)).toBeNull();
  });
});

describe('checkCallingHours', () => {
  it('allows a weekday mid-afternoon in the lead\'s own zone', () => {
    // Mon 18:00 UTC = 2:00 PM Eastern
    expect(checkCallingHours('NY', at('2026-10-05T18:00:00Z'))).toEqual({ ok: true });
  });
  it('refuses before 8 AM and from 9 PM local', () => {
    expect(checkCallingHours('NY', at('2026-10-05T11:30:00Z'))).toEqual({ ok: false, reason: 'too_early' }); // 7:30 ET
    expect(checkCallingHours('NY', at('2026-10-06T01:30:00Z'))).toEqual({ ok: false, reason: 'too_late' }); // 9:30 PM ET
  });
  it('is on the Pacific clock for a California lead', () => {
    // Mon 14:00 UTC = 7:00 AM Pacific: too early in CA even though it is 10 AM Eastern
    expect(checkCallingHours('CA', at('2026-10-05T14:00:00Z'))).toEqual({ ok: false, reason: 'too_early' });
    expect(checkCallingHours('CA', at('2026-10-05T16:00:00Z'))).toEqual({ ok: true }); // 9 AM PT
  });
  it('holds a two-zone state to the stricter edge (Florida: 9 AM Eastern is 8 AM Central)', () => {
    expect(checkCallingHours('FL', at('2026-10-05T12:30:00Z'))).toEqual({ ok: false, reason: 'too_early' }); // 8:30 ET / 7:30 CT
    expect(checkCallingHours('FL', at('2026-10-05T13:30:00Z'))).toEqual({ ok: true }); // 9:30 ET / 8:30 CT
  });
  it('refuses weekends and unknown states', () => {
    expect(checkCallingHours('NY', at('2026-10-03T18:00:00Z'))).toEqual({ ok: false, reason: 'weekend' }); // Saturday
    expect(checkCallingHours('ZZ', at('2026-10-05T18:00:00Z'))).toEqual({ ok: false, reason: 'unknown_state' });
    expect(checkCallingHours(null, at('2026-10-05T18:00:00Z'))).toEqual({ ok: false, reason: 'unknown_state' });
  });
});

describe('localTimeLabel', () => {
  it('shows the lead\'s local time', () => {
    expect(localTimeLabel('NY', at('2026-10-05T18:05:00Z'))).toBe('2:05 PM');
    expect(localTimeLabel('CA', at('2026-10-05T18:05:00Z'))).toBe('11:05 AM');
    expect(localTimeLabel('ZZ')).toBeNull();
  });
});
