import { describe, it, expect, vi, afterEach } from 'vitest';
import { intlCallCountries, normalizeIntl, intlState, INTL_COUNTRIES } from '@/lib/intlCalling';
import { normalizeDialable, decideDial } from '@/lib/outboundCalling';
import { checkCallingHours, STATE_ZONES, INTL_STATES } from '@/lib/callingHours';

const ALL = new Set(['AU', 'NZ', 'SG', 'GB', 'IN', 'IE']);
afterEach(() => vi.unstubAllEnvs());

describe('international numbers', () => {
  it('is off unless countries are listed', () => {
    expect(intlCallCountries({}).size).toBe(0);
    expect([...intlCallCountries({ INTL_CALL_COUNTRIES: 'au, gb ,xx' })].sort()).toEqual(['AU', 'GB']);
    expect(normalizeIntl('+61415043232', new Set())).toBeNull();
  });
  it('accepts ordinary lines in an allowed country', () => {
    expect(normalizeIntl('+61 415 043 232', ALL)).toEqual({ e164: '+61415043232', iso: 'AU' }); // mobile
    expect(normalizeIntl('+61290001380', ALL)?.iso).toBe('AU'); // Sydney landline
    expect(normalizeIntl('+611300368425', ALL)?.iso).toBe('AU'); // 1300
    expect(normalizeIntl('+442034109897', ALL)?.iso).toBe('GB');
    expect(normalizeIntl('+447368898746', ALL)?.iso).toBe('GB');
    expect(normalizeIntl('+441633647895', ALL)?.iso).toBe('GB');
    expect(normalizeIntl('+919090302301', ALL)?.iso).toBe('IN');
    expect(normalizeIntl('+912245678901', ALL)?.iso).toBe('IN');
    expect(normalizeIntl('+6531296155', ALL)?.iso).toBe('SG');
    expect(normalizeIntl('+6492430260', ALL)?.iso).toBe('NZ');
    expect(normalizeIntl('+64224206578', ALL)?.iso).toBe('NZ');
  });
  it('rejects premium, personal-numbering, truncated and unlisted-country numbers', () => {
    expect(normalizeIntl('+449099000000', ALL)).toBeNull(); // UK 09 premium
    expect(normalizeIntl('+447000123456', ALL)).toBeNull(); // UK 070 personal
    expect(normalizeIntl('+4411812345678', ALL)).toBeNull(); // 118 directory
    expect(normalizeIntl('+611900123456', ALL)).toBeNull(); // AU 1900
    expect(normalizeIntl('+9183675359', ALL)).toBeNull(); // truncated
    expect(normalizeIntl('+14256284887', ALL)).toBeNull(); // US is not international
    expect(normalizeIntl('0415043232', ALL)).toBeNull(); // no country code
    expect(normalizeIntl('+8613812345678', ALL)).toBeNull(); // China not listed
    expect(normalizeIntl('+61415043232', new Set(['GB']))).toBeNull(); // AU not switched on
  });
  it('picks the local clock, Australia by city', () => {
    expect(intlState('AU', 'Perth, AU')).toBe('AU-PER');
    expect(intlState('AU', 'Adelaide, AU')).toBe('AU-ADL');
    expect(intlState('AU', 'Gold Coast, AU')).toBe('AU-BNE');
    expect(intlState('AU', 'Melbourne, AU')).toBe('AU-SYD');
    expect(intlState('GB', 'Leeds, GB')).toBe('GB-LON');
    expect(intlState('IN', 'Pune, IN')).toBe('IN-IST');
    for (const c of Object.values(INTL_COUNTRIES)) expect(STATE_ZONES[c.defaultState]).toBeTruthy();
    for (const k of INTL_STATES) expect(STATE_ZONES[k]).toBeTruthy();
  });
});

describe('business hours for international leads', () => {
  it('allows 9 to 17 local on weekdays', () => {
    // Fri 2026-10-09 00:00 UTC = 11:00 in Sydney (AEDT), 01:00 in London
    expect(checkCallingHours('AU-SYD', new Date('2026-10-09T00:00:00Z'))).toEqual({ ok: true });
    expect(checkCallingHours('GB-LON', new Date('2026-10-09T00:00:00Z'))).toEqual({ ok: false, reason: 'too_early' });
    expect(checkCallingHours('GB-LON', new Date('2026-10-09T10:00:00Z'))).toEqual({ ok: true }); // 11:00 BST
    expect(checkCallingHours('AU-SYD', new Date('2026-10-09T07:00:00Z'))).toEqual({ ok: false, reason: 'too_late' }); // 18:00 AEDT
    expect(checkCallingHours('IN-IST', new Date('2026-10-09T04:00:00Z'))).toEqual({ ok: true }); // 09:30 IST
    expect(checkCallingHours('IN-IST', new Date('2026-10-09T03:00:00Z'))).toEqual({ ok: false, reason: 'too_early' }); // 08:30 IST
  });
  it('refuses weekends in the lead local time', () => {
    // Sat 2026-10-10 02:00 UTC = Sat 13:00 Sydney; Fri 2026-10-09 23:00 UTC = Sat 10:00 Sydney
    expect(checkCallingHours('AU-SYD', new Date('2026-10-10T02:00:00Z'))).toEqual({ ok: false, reason: 'weekend' });
    expect(checkCallingHours('AU-SYD', new Date('2026-10-09T23:00:00Z'))).toEqual({ ok: false, reason: 'weekend' });
  });
  it('leaves US and Canada windows untouched', () => {
    expect(checkCallingHours('TX', new Date('2026-10-09T14:00:00Z'))).toEqual({ ok: true }); // 09:00 Central
    expect(checkCallingHours('ON', new Date('2026-10-09T12:30:00Z'))).toEqual({ ok: false, reason: 'too_early' }); // 08:30 Toronto
  });
});

describe('the sales line gate', () => {
  const caller = { caller_id: '+19893738407', enabled: true };
  const base = { sipUsername: 'mary', caller, leadId: 'l1', inBatch: true, hours: { ok: true } as const, doNotCall: false, requireLead: true, dialsToday: 0, maxDialsPerDay: 400 };
  it('keeps international numbers blocked by default', () => {
    expect(normalizeDialable('+61415043232', new Set())).toBeNull();
    const d = decideDial({ ...base, to: '+61415043232' });
    expect(d).toMatchObject({ ok: false, reason: 'invalid_number' });
  });
  it('dials them once the country is switched on, and still gates on the batch and hours', () => {
    vi.stubEnv('INTL_CALL_COUNTRIES', 'AU');
    expect(normalizeDialable('+61415043232')).toBe('+61415043232');
    expect(decideDial({ ...base, to: '+61415043232' })).toMatchObject({ ok: true, to: '+61415043232' });
    expect(decideDial({ ...base, to: '+61415043232', inBatch: false })).toMatchObject({ ok: false, reason: 'not_in_todays_batch' });
    expect(decideDial({ ...base, to: '+61415043232', hours: { ok: false, reason: 'too_late' } })).toMatchObject({ ok: false, reason: 'outside_calling_hours' });
    expect(decideDial({ ...base, to: '+442034109897' })).toMatchObject({ ok: false, reason: 'invalid_number' }); // GB not on
  });
  it('US numbers still work with no variable set', () => {
    expect(normalizeDialable('(425) 628-4887')).toBe('+14256284887');
  });
});
