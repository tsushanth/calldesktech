import { describe, it, expect } from 'vitest';
import { candidateDomains, guessWebsite } from '@/lib/outreach/discovery/domainGuess';

describe('candidateDomains', () => {
  it('puts the obvious joined name first and drops legal suffixes', () => {
    const c = candidateDomains('Allen Electrical Service LLC', 'Henrico');
    expect(c[0]).toBe('allenelectricalservice.com');
    expect(c).toContain('allenelectrical.com');
    expect(c.every((d) => !d.includes('llc.') || d.includes('llc'))).toBe(true);
  });
  it('handles ampersands, apostrophes and punctuation', () => {
    expect(candidateDomains("Mc'Grady & Perdue Heating INC", 'Salem')).toContain('mcgradyandperduehealing.com'.replace('healing', 'heating'));
    expect(candidateDomains('A.t.d. Contractors LLC', 'Elkton')).toContain('atdcontractors.com');
  });
  it('is capped, de-duplicated, and empty for an empty name', () => {
    const c = candidateDomains('Chantilly Electric LLC', 'Chantilly', 15);
    expect(c.length).toBeLessThanOrEqual(15);
    expect(new Set(c).size).toBe(c.length);
    expect(candidateDomains('', null)).toEqual([]);
  });
});

const html = (body: string) => `<html><body>${body}${' filler text'.repeat(40)}</body></html>`;

describe('guessWebsite', () => {
  const id = { name: 'Allen Electrical Service LLC', legalName: null, city: 'Henrico', state: 'VA', phone: null };
  const resolveOnly = (set: string[]) => async (d: string) => set.includes(d);

  it('accepts a resolving domain whose page shows the business name and its city/state', async () => {
    const r = await guessWebsite(id, {
      resolve: resolveOnly(['allenelectricalservice.com']),
      fetchPage: async () => ({ ok: true, text: html('<h1>Allen Electrical Service</h1><p>Serving Henrico, VA since 1999</p>') }),
    });
    expect(r.domain).toBe('allenelectricalservice.com');
  });
  it('rejects a resolving domain whose page is another business or another place', async () => {
    const other = await guessWebsite(id, { resolve: resolveOnly(['allenelectricalservice.com']), fetchPage: async () => ({ ok: true, text: html('<h1>Buy this domain</h1><p>Parked page</p>') }) });
    expect(other.domain).toBeNull();
    const wrongCity = await guessWebsite(id, { resolve: resolveOnly(['allenelectricalservice.com']), fetchPage: async () => ({ ok: true, text: html('<h1>Allen Electrical Service</h1><p>Phoenix, AZ</p>') }) });
    expect(wrongCity.domain).toBeNull();
  });
  it('returns nothing when no candidate resolves', async () => {
    const r = await guessWebsite(id, { resolve: async () => false, fetchPage: async () => { throw new Error('should not fetch'); } });
    expect(r.domain).toBeNull();
    expect(r.resolved).toEqual([]);
  });
});
