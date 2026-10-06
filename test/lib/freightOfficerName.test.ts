import { describe, expect, it } from 'vitest';
import { officerNameFromCensus, toCandidate } from '@/lib/outreach/discovery/freightFmcsa';

describe('officerNameFromCensus', () => {
  it('title-cases a first and last name', () => {
    expect(officerNameFromCensus({ company_officer_1: 'WILLIAM WALKER' })).toBe('William Walker');
    expect(officerNameFromCensus({ company_officer_1: '  alfredo   limon ' })).toBe('Alfredo Limon');
    expect(officerNameFromCensus({ company_officer_1: 'JOHN MCDONALD' })).toBe('John McDonald');
  });
  it('flips LAST, FIRST', () => {
    expect(officerNameFromCensus({ company_officer_1: 'WALKER, WILLIAM' })).toBe('William Walker');
  });
  it('falls back to officer 2 when officer 1 is unusable', () => {
    expect(officerNameFromCensus({ company_officer_1: 'ACME LOGISTICS LLC', company_officer_2: 'MARIA GOMEZ' })).toBe('Maria Gomez');
  });
  it('rejects companies, single words, initials, digits and empties', () => {
    for (const bad of ['', 'ACME LOGISTICS LLC', 'WILLIAM', 'J S', 'J SMITH', 'JOHN 2', 'BIG FREIGHT INC', 'SMITH TRUCKING CO', undefined, null]) {
      expect(officerNameFromCensus({ company_officer_1: bad as string | undefined })).toBeNull();
    }
    expect(officerNameFromCensus(undefined)).toBeNull();
  });
  it('keeps a three-part name with a middle initial', () => {
    expect(officerNameFromCensus({ company_officer_1: 'MARY A JONES' })).toBe('Mary A Jones');
  });
});

describe('toCandidate', () => {
  it('carries the officer as contactName', () => {
    const c = toCandidate(
      { docket_number: 'MC108018', dot_number: '3156305', legal_name: 'SPECTRUM TRUCKING & LOGISTICS INC' },
      { email_address: 'x@spectrum.example', company_officer_1: 'WILLIAM WALKER', phone: '7137317913' },
      { adjust: 0, reasons: [] },
    );
    expect(c.contactName).toBe('William Walker');
  });
});
