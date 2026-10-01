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
