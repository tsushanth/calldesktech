import { describe, it, expect } from 'vitest';
import { looksLikeIndividual } from '@/lib/outreach/discovery/individualName';

// Name-filter regression cases contributed by each state-loader review (each branch tuned the shared
// word list against its own registry's names). All must pass against the single merged filter.

describe('cases from review/northeast', () => {

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

describe('child care programme and institution names are not individuals', () => {
  it('does not flag real centres or organisations', () => {
    for (const n of ['Cradles To Crayons', 'Little Sprouts', 'The Nest', 'Salvation Army', 'Wheaton College', 'Head Start', 'City Of Garfield', 'Njdcf Ooe']) expect(looksLikeIndividual(n), n).toBe(false);
    expect(looksLikeIndividual('Jeffrey Kyle Porter')).toBe(true);
  });
});

});

describe('cases from review/southeast', () => {

describe('looksLikeIndividual', () => {
  it('flags person-named sole proprietors seen in the Virginia registry', () => {
    for (const n of ['Jeffrey Kyle Porter', 'John W Bonner Iv', 'John C Royster', 'Robbie Glen Ragland', 'Bruce E Berkheimer', 'Edward Timothy Self', 'Terrence E Johnson Sr', 'David W Phillips'])
      expect(looksLikeIndividual(n), n).toBe(true);
  });
  it('never flags businesses, including ones that look like a name plus a trade word', () => {
    for (const n of ['American Plumbing INC', 'Chantilly Electric LLC', 'Allen Electrical Service LLC', 'C My Handyman LLC', 'M&B Hvac Troubleshooters LLC', 'Smith Brothers', 'Smith & Sons', 'Aztec Electric Service INC', 'Joe Roofing', 'ABC 24 Hour Plumbing', 'Powhatan', 'Little Acorns Learning Center', 'Tiny Tots Day Care', 'Happy Kids Academy', 'Bright Horizons Early Education', 'Kiddie Kampus Child Care', 'Grace Church Preschool', 'Sunrise Montessori School', 'Harbor Home Health', 'Tri County Towing'])
      expect(looksLikeIndividual(n), n).toBe(false);
  });
  it('never flags generic home-care / child-care / trade names that read like two plain words', () => {
    for (const n of ['Visiting Angels', 'Comfort Keepers', 'Senior Helpers', 'Liberty Head Start', 'Authoracare Collective', 'Carolina SeniorCare', 'Cool Temp', 'Hi Tech', 'Weeks Sheetmetal', 'Companions ii of North Carolina', 'Highland Investors Limited Partnership', 'Busy Bees Educare', 'Wee Kare'])
      expect(looksLikeIndividual(n), n).toBe(false);
    expect(looksLikeIndividual('Stephen Kellon Pope')).toBe(true);
    expect(looksLikeIndividual('Nannette Ross')).toBe(true);
  });
  it('handles empty input', () => { expect(looksLikeIndividual('')).toBe(false); expect(looksLikeIndividual(null)).toBe(false); });
});

});

describe('cases from review/mountain', () => {

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
    for (const n of ['Straight Outta Vegas Bail Bonds', 'Arizona Desert Head Start', 'Busy Bees Arizona Tempe', 'Hills Family Dentistry Pc', 'Building Kidz Of Gilbert', 'Elevated Benefits Pllc', 'Growing Great Learners Prescho', 'Willamette Valley Animal Hospi', 'Policy Pioneers', 'Jay P Malmquist Dmd Pc']) {
      expect(looksLikeIndividual(n), n).toBe(false);
    }
  });
  it('still flags real person names, including ones with a middle initial A and surnames Bond/Senior', () => {
    for (const n of ['John A Smith', 'Kevin Bond', 'Mark Paradis', 'Maria De La Cruz']) expect(looksLikeIndividual(n), n).toBe(true);
  });
});

});

describe('cases from review/plains', () => {

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

});

describe('cases from review/midwest', () => {

describe('looksLikeIndividual', () => {
  it('flags person-named sole proprietors seen in the Virginia registry', () => {
    for (const n of ['Jeffrey Kyle Porter', 'John W Bonner Iv', 'John C Royster', 'Robbie Glen Ragland', 'Bruce E Berkheimer', 'Edward Timothy Self', 'Terrence E Johnson Sr', 'David W Phillips'])
      expect(looksLikeIndividual(n), n).toBe(true);
  });
  it('never flags businesses, including ones that look like a name plus a trade word', () => {
    for (const n of ['American Plumbing INC', 'Chantilly Electric LLC', 'Allen Electrical Service LLC', 'C My Handyman LLC', 'M&B Hvac Troubleshooters LLC', 'Smith Brothers', 'Smith & Sons', 'Aztec Electric Service INC', 'Joe Roofing', 'ABC 24 Hour Plumbing', 'Powhatan', 'Little Acorns Learning Center', 'Tiny Tots Day Care', 'Happy Kids Academy', 'Bright Horizons Early Education', 'Kiddie Kampus Child Care', 'Grace Church Preschool', 'Sunrise Montessori School', 'Harbor Home Health', 'Tri County Towing', 'Northern Climate Control', 'Rivercity Refrigeration', 'Moon Beam Power', 'City Of Duluth', 'Peoples Energy Cooperative', 'Culligan Water', 'Mister Sparky Of Greater Columbus', 'Kamphs Hardware', 'Nuts About Comfort', 'Sturgeon Bay Head Start', 'Salvation Army Oak Creek', 'Ecc On Campus', 'Valu Rooter', 'Precision Pipe Works'])
      expect(looksLikeIndividual(n), n).toBe(false);
  });
  it('handles empty input', () => { expect(looksLikeIndividual('')).toBe(false); expect(looksLikeIndividual(null)).toBe(false); });
});

});
