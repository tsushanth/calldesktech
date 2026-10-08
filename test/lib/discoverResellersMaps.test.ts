import { describe, it, expect } from 'vitest';
import { relevantListing, CITIES, QUERIES } from '../../harness/outreach/discover-resellers-maps';

describe('Maps reseller discovery filter', () => {
  it('keeps businesses whose name says AI / voice / automation', () => {
    expect(relevantListing('WTech AI Agency London Business Automation', 'Software company')).toBe(true);
    expect(relevantListing('AI Answering Service', 'Telephone answering service')).toBe(true);
    expect(relevantListing('Prismo AI', 'Software company')).toBe(true);
    expect(relevantListing('Independent Voice AI Labs', 'Software company')).toBe(true);
  });
  it('drops listings whose name has no AI or voice signal', () => {
    expect(relevantListing('Visual Voice Global Media', 'Marketing agency')).toBe(true); // "voice" in the name is enough
    expect(relevantListing('Smith Accounting', 'Accountant')).toBe(false);
  });
  it('drops recruiters, talent and speaker agencies, studios and the like', () => {
    expect(relevantListing('AI Hospitality Solutions', 'Recruitment Agency')).toBe(false);
    expect(relevantListing('The AI Speakers Agency', 'Entertainment agency')).toBe(false);
    expect(relevantListing('Voice agency Inter Voice Over - London', 'Talent agency')).toBe(false);
    expect(relevantListing('GoLocalise AI Voice', 'Recording studio')).toBe(false);
    expect(relevantListing('Bright Smile Dental AI', 'Dentist')).toBe(false);
  });
  it('plans queries for the first-wave countries', () => {
    for (const c of ['AU', 'NZ', 'SG', 'GB', 'IN']) expect(CITIES[c].length).toBeGreaterThan(0);
    expect(QUERIES.length).toBeGreaterThanOrEqual(5);
  });
});
