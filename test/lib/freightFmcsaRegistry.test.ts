import { describe, expect, it } from 'vitest';
import { censusPhone, evaluateBroker, type AuthorityRow, type CensusRow } from '@/lib/outreach/discovery/freightFmcsa';
import { toFmcsaRegistryLead } from '@/lib/outreach/discovery/freightFmcsaRegistry';

const auth: AuthorityRow = { docket_number: 'MC443795', dot_number: '2229942', broker_stat: 'A', bond_file: 'Y', legal_name: 'COUNTY LINE TRANSPORT INC', bus_city: 'COLE CAMP', bus_state_code: 'MO', bus_ctry_code: 'US' };
const census: CensusRow = { dot_number: '2229942', legal_name: 'COUNTY LINE TRANSPORT INC', email_address: 'terryv@clttransport.com', phone: '6305546101', status_code: 'A', power_units: '0' };

describe('FMCSA broker phone loading', () => {
  it('formats the census phone and rejects implausible numbers', () => {
    expect(censusPhone(census)).toBe('+16305546101');
    expect(censusPhone({ phone: '1-630-554-6101' })).toBe('+16305546101');
    // bus_telno from the authority file is used when the census has no valid phone, or none at all
    expect(censusPhone(undefined, '2032650921')).toBe('+12032650921');
    expect(censusPhone({ phone: '555' }, '2032650921')).toBe('+12032650921');
    expect(censusPhone({ phone: '6305546101' }, '2032650921')).toBe('+16305546101');
    expect(censusPhone({ phone: '2125550123' })).toBeNull(); // fictional 555-01XX range
    expect(censusPhone({ phone: '9005551234' })).toBeNull(); // premium-rate area code
    expect(censusPhone({ phone: '0000000000' })).toBeNull();
    expect(censusPhone({ phone: '1111111111' })).toBeNull();
    expect(censusPhone({ phone: '555' })).toBeNull();
    expect(censusPhone(undefined)).toBeNull();
  });

  it('still requires an email by default', () => {
    const noEmail = { ...census, email_address: undefined };
    expect(evaluateBroker(auth, noEmail)).toMatchObject({ keep: false, reason: 'no valid published email' });
  });

  it('keeps a phone-only broker when allowNoEmail is set, and drops one with neither', () => {
    const noEmail = { ...census, email_address: undefined };
    expect(evaluateBroker(auth, noEmail, new Date(), { allowNoEmail: true })).toMatchObject({ keep: true });
    expect(evaluateBroker(auth, { ...noEmail, phone: undefined }, new Date(), { allowNoEmail: true })).toMatchObject({ keep: false });
  });

  it('builds a registry lead keyed like the per-run stage, with the phone', () => {
    const ev = evaluateBroker(auth, census);
    if (!ev.keep) throw new Error('expected keep');
    const lead = toFmcsaRegistryLead(auth, census, ev);
    expect(lead.sourceKey).toBe('freight:mc:443795');
    expect(lead.phone).toBe('+16305546101');
    expect(lead.email).toBe('terryv@clttransport.com');
    expect(lead.callerPhoneExcluded).toBeNull();
  });

  it('marks a person-named broker as a personal line', () => {
    const person = { ...auth, legal_name: 'JOHN A SMITH' };
    const ev = evaluateBroker(person, { ...census, legal_name: 'JOHN A SMITH' });
    if (!ev.keep) throw new Error('expected keep');
    expect(toFmcsaRegistryLead(person, { ...census, legal_name: 'JOHN A SMITH' }, ev).callerPhoneExcluded).toBeTruthy();
  });
});
