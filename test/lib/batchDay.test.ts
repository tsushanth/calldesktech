import { describe, it, expect } from 'vitest';
import { batchDateEastern, startOfEasternDay } from '@/lib/callingHours';

const d = (iso: string) => batchDateEastern(new Date(iso));

describe('batch day starts at 6:00 AM Eastern', () => {
  it('rolls over at 6:00 AM Eastern, not at midnight (daylight time, UTC-4)', () => {
    expect(d('2026-10-15T03:59:00Z')).toBe('2026-10-14'); // 11:59 PM Oct 14 Eastern
    expect(d('2026-10-15T04:00:00Z')).toBe('2026-10-14'); // midnight Eastern: still Oct 14
    expect(d('2026-10-15T09:59:00Z')).toBe('2026-10-14'); // 5:59 AM Eastern
    expect(d('2026-10-15T10:00:00Z')).toBe('2026-10-15'); // 6:00 AM Eastern
  });
  it('rolls over at 6:00 AM Eastern in winter (UTC-5)', () => {
    expect(d('2026-12-15T10:59:00Z')).toBe('2026-12-14');
    expect(d('2026-12-15T11:00:00Z')).toBe('2026-12-15');
  });
  it('a 5 PM to 11 PM Pacific shift stays on one batch day (Manila hours)', () => {
    // 5:00 PM PDT Oct 14 = 00:00Z Oct 15; 10:59 PM PDT = 05:59Z Oct 15
    for (const iso of ['2026-10-15T00:00:00Z', '2026-10-15T03:59:00Z', '2026-10-15T04:01:00Z', '2026-10-15T05:59:00Z']) expect(d(iso)).toBe('2026-10-14');
    // same in winter (PST, UTC-8): 5 PM PST Dec 14 = 01:00Z Dec 15; 10:59 PM PST = 06:59Z
    for (const iso of ['2026-12-15T01:00:00Z', '2026-12-15T05:00:00Z', '2026-12-15T06:59:00Z']) expect(d(iso)).toBe('2026-12-14');
  });
  it('the next shift is the next batch day', () => {
    expect(d('2026-10-16T00:00:00Z')).toBe('2026-10-15');
  });
  it('US daytime calling is unchanged', () => {
    expect(d('2026-10-14T17:00:00Z')).toBe('2026-10-14'); // 1 PM Eastern
    expect(d('2026-10-15T00:30:00Z')).toBe('2026-10-14'); // 8:30 PM Eastern
  });
  it('is not moved by the November clock change (Nov 1, 2026: 2 AM EDT becomes 1 AM EST)', () => {
    expect(d('2026-11-01T09:59:00Z')).toBe('2026-10-31'); // 4:59 AM EST
    expect(d('2026-11-01T10:59:00Z')).toBe('2026-10-31'); // 5:59 AM EST
    expect(d('2026-11-01T11:00:00Z')).toBe('2026-11-01'); // 6:00 AM EST
  });
  it('is not moved by the March clock change (Mar 14, 2027: 2 AM EST becomes 3 AM EDT)', () => {
    expect(d('2027-03-14T09:59:00Z')).toBe('2027-03-13'); // 5:59 AM EDT
    expect(d('2027-03-14T10:00:00Z')).toBe('2027-03-14'); // 6:00 AM EDT
  });
  it('month and year boundaries', () => {
    expect(d('2026-11-01T08:00:00Z')).toBe('2026-10-31');
    expect(d('2027-01-01T08:00:00Z')).toBe('2026-12-31');
  });
  it('startOfEasternDay is the 6:00 AM Eastern instant of the batch day, also across clock changes', () => {
    expect(startOfEasternDay(new Date('2026-11-01T15:00:00Z')).toISOString()).toBe('2026-11-01T11:00:00.000Z');
    expect(startOfEasternDay(new Date('2026-11-01T09:00:00Z')).toISOString()).toBe('2026-10-31T10:00:00.000Z');
    expect(startOfEasternDay(new Date('2027-03-14T15:00:00Z')).toISOString()).toBe('2027-03-14T10:00:00.000Z');
    expect(startOfEasternDay(new Date('2026-10-15T05:00:00Z')).toISOString()).toBe('2026-10-14T10:00:00.000Z');
  });
});
