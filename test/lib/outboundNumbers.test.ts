import { describe, it, expect } from 'vitest';
import { areaCodeOf, pickPoolNumber, type PoolNumber } from '@/lib/outboundNumbers';
import { startOfEasternDay } from '@/lib/callingHours';

const pool: PoolNumber[] = [
  { phone: '+19569279405', area_codes: ['956'], daily_cap: 3, enabled: true },
  { phone: '+13465178550', area_codes: ['281', '713', '832', '346'], daily_cap: 3, enabled: true },
  { phone: '+14692777547', area_codes: ['214', '469', '972'], daily_cap: 3, enabled: true },
];

describe('areaCodeOf', () => {
  it('reads the area code from E.164', () => {
    expect(areaCodeOf('+19569279405')).toBe('956');
    expect(areaCodeOf('(956) 927-9405')).toBeNull();
    expect(areaCodeOf(null)).toBeNull();
  });
});

describe('pickPoolNumber', () => {
  it('prefers a number whose area code matches the person called', () => {
    expect(pickPoolNumber(pool, {}, '+19565550142')?.phone).toBe('+19569279405'); // Rio Grande Valley
    expect(pickPoolNumber(pool, {}, '+17135550142')?.phone).toBe('+13465178550'); // Houston (713)
    expect(pickPoolNumber(pool, {}, '+12145550142')?.phone).toBe('+14692777547'); // Dallas (214)
  });
  it('spreads load to the least-used number when nothing matches', () => {
    const usage = { '+19569279405': 2, '+13465178550': 0, '+14692777547': 1 };
    expect(pickPoolNumber(pool, usage, '+14255550142')?.phone).toBe('+13465178550');
  });
  it('skips a matching number that has reached its daily cap', () => {
    const usage = { '+19569279405': 3 };
    const p = pickPoolNumber(pool, usage, '+19565550142');
    expect(p?.phone).not.toBe('+19569279405');
    expect(p).not.toBeNull();
  });
  it('ignores disabled numbers', () => {
    const p = pickPoolNumber(pool.map((n) => (n.phone === '+19569279405' ? { ...n, enabled: false } : n)), {}, '+19565550142');
    expect(p?.phone).not.toBe('+19569279405');
  });
  it('returns null when every number is at its cap, so the call is refused', () => {
    const usage = { '+19569279405': 3, '+13465178550': 3, '+14692777547': 3 };
    expect(pickPoolNumber(pool, usage, '+19565550142')).toBeNull();
    expect(pickPoolNumber([], {}, '+19565550142')).toBeNull();
  });
  it('breaks ties by phone number so the choice is stable', () => {
    expect(pickPoolNumber(pool, {}, '+14255550142')?.phone).toBe('+13465178550');
  });
});

describe('startOfEasternDay', () => {
  it('is 04:00 UTC during daylight time and 05:00 UTC in winter', () => {
    expect(startOfEasternDay(new Date('2026-10-05T18:00:00Z')).toISOString()).toBe('2026-10-05T04:00:00.000Z');
    expect(startOfEasternDay(new Date('2026-12-15T18:00:00Z')).toISOString()).toBe('2026-12-15T05:00:00.000Z');
  });
  it('belongs to the Eastern date, not the UTC date', () => {
    // 02:00 UTC on Oct 6 is still the evening of Oct 5 in New York
    expect(startOfEasternDay(new Date('2026-10-06T02:00:00Z')).toISOString()).toBe('2026-10-05T04:00:00.000Z');
  });
});
