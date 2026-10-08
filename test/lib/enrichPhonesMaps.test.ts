import { describe, it, expect } from 'vitest';
import { searchCountry, bareDomain, toE164 } from '../../harness/outreach/enrich-phones-maps';

describe('phone enrichment helpers', () => {
  it('searches in the lead country: location code first, then domain TLD, else the US', () => {
    expect(searchCountry('Brisbane, AU', 'example.com')).toBe('Australia');
    expect(searchCountry(null, 'studio.co.nz')).toBe('New Zealand');
    expect(searchCountry(null, 'agency.co.uk')).toBe('United Kingdom');
    expect(searchCountry('Austin, TX', 'agency.com')).toBe('United States');
    expect(searchCountry(null, 'agency.com')).toBe('United States');
  });
  it('compares domains without scheme, www or path', () => {
    expect(bareDomain('https://www.Peakdemand.ca/contact')).toBe('peakdemand.ca');
    expect(bareDomain('peakdemand.ca')).toBe('peakdemand.ca');
    expect(bareDomain(null)).toBe('');
  });
  it('keeps only international-format numbers', () => {
    expect(toE164('+1647-691-0082')).toBe('+16476910082');
    expect(toE164('+61 7 2142 4679')).toBe('+61721424679');
    expect(toE164('0412 345 678')).toBeNull();
    expect(toE164('')).toBeNull();
  });
});
