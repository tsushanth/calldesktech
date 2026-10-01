import { describe, it, expect } from 'vitest';
import { looksLikeIndividual } from '@/lib/outreach/discovery/individualName';

describe('looksLikeIndividual', () => {
  it('flags person-named sole proprietors seen in the Virginia registry', () => {
    for (const n of ['Jeffrey Kyle Porter', 'John W Bonner Iv', 'John C Royster', 'Robbie Glen Ragland', 'Bruce E Berkheimer', 'Edward Timothy Self', 'Terrence E Johnson Sr', 'David W Phillips'])
      expect(looksLikeIndividual(n), n).toBe(true);
  });
  it('never flags businesses, including ones that look like a name plus a trade word', () => {
    for (const n of ['American Plumbing INC', 'Chantilly Electric LLC', 'Allen Electrical Service LLC', 'C My Handyman LLC', 'M&B Hvac Troubleshooters LLC', 'Smith Brothers', 'Smith & Sons', 'Aztec Electric Service INC', 'Joe Roofing', 'ABC 24 Hour Plumbing', 'Powhatan', 'Little Acorns Learning Center', 'Tiny Tots Day Care', 'Happy Kids Academy', 'Bright Horizons Early Education', 'Kiddie Kampus Child Care', 'Grace Church Preschool', 'Sunrise Montessori School', 'Harbor Home Health', 'Tri County Towing'])
      expect(looksLikeIndividual(n), n).toBe(false);
  });
  it('handles empty input', () => { expect(looksLikeIndividual('')).toBe(false); expect(looksLikeIndividual(null)).toBe(false); });
});

describe('looksLikeIndividual: business-word coverage from the NV/OR/AZ registries', () => {
  it('does not flag two-to-four word business names', () => {
    for (const n of ['Straight Outta Vegas Bail Bonds', 'Arizona Desert Head Start', 'Busy Bees Arizona Tempe', 'Hills Family Dentistry Pc', 'Building Kidz Of Gilbert', 'Elevated Benefits Pllc', 'Growing Great Learners Prescho', 'Willamette Valley Animal Hospi', 'Policy Pioneers']) {
      expect(looksLikeIndividual(n), n).toBe(false);
    }
  });
  it('still flags real person names, including ones with a middle initial A and surnames Bond/Senior', () => {
    for (const n of ['John A Smith', 'Kevin Bond', 'Mark Paradis', 'Jay P Malmquist Dmd Pc', 'Maria De La Cruz']) expect(looksLikeIndividual(n), n).toBe(true);
  });
});
