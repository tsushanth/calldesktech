import { describe, it, expect } from 'vitest';
import {
  parseNvDoiCsv, evaluateNvDoiRow, toNvDoiLead, parseNvDate, nvDoiPageUrl, NV_DOI_CSV_URL, streamNvDoiLeads,
} from '@/lib/outreach/discovery/nvDoiFirms';
import {
  evaluateOrEmployerRow, toOrEmployerLead, orPhone, orSourceKey, orClassForDay, orSupportsVertical, OR_NAICS, type OrEmployerRow,
} from '@/lib/outreach/discovery/orWorkersComp';
import {
  evaluateAzChildcareRow, toAzChildcareLead, streamAzChildcareLeads, type AzChildcareRow,
} from '@/lib/outreach/discovery/childcareAz';

const NOW = new Date('2026-09-30T12:00:00Z');

// ---------------------------------------------------------------------------
describe('NV DOI firm list', () => {
  const csv = [
    'Firm License Type,License ,Name,Address,City,State,Zip,Phone,Email,Original Issue Date ,Expiration Date ',
    'Resident Producer Firm,3264218,1 Stop Insurance & Multiservices,"2029 S. Decatur Blvd Las Vegas, Nv. 89102",Las Vegas (Clark),Nv,89102, 702-635-4354,info@onestoplv.com,8/14/2017,8/31/2029',
    'Resident Producer Firm,3791391,"1700 Industrial Self Storage, Llc","4200 Wisconsin Ave, Nw",Washington,Dc,20016, 702-366-9880,caesar@1700industrial.com,5/2/2022,7/31/2028',
    'Resident Producer Firm,111,Jane Q Smith Insurance Agency,1 Main,Reno,Nv,89501, 775-555-0100,jane.smith@statefarm.com,1/1/2010,12/31/2028',
    'Resident Producer Firm,222,Old Agency Llc,1 Main,Reno,Nv,89501, 775-555-0101,old@oldagency.com,1/1/2010,12/31/2025',
    'Resident Producer Firm,333,Carson Benefits Group,1 Main,Carson City,Nv,89701, 775-555-0102,,1/1/2015,12/31/2028',
    'Resident Producer Firm,444,Maria Lopez,1 Main,Henderson,Nv,89002,,maria@gmail.com,1/1/2015,12/31/2028',
    'Resident Producer Firm,555,Ghost Llc,1 Main,Henderson,Nv,89002,,,1/1/2015,12/31/2028',
    'Resident Producer Firm,666,Utah Cross Agency Inc,9 Elm,Orem,Ut,84097, 801-555-0103,hello@crossagency.com,1/1/2015,12/31/2028',
  ].join('\n');
  const rows = parseNvDoiCsv(csv);

  it('parses the APEX CSV (quoted commas, trailing-space headers, city annotation)', () => {
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({ license: '3264218', city: 'Las Vegas', email: 'info@onestoplv.com', expires: '8/31/2029' });
    expect(rows[1].name).toBe('1700 Industrial Self Storage, Llc');
  });

  it('fails loudly when the header changes', () => {
    expect(() => parseNvDoiCsv('a,b,c\n1,2,3')).toThrow(/header changed/);
  });

  it('keeps a good agency with email and phone and builds the lead', () => {
    const ev = evaluateNvDoiRow(rows[0], 'insurance', NOW);
    expect(ev.keep).toBe(true);
    if (!ev.keep) return;
    const lead = toNvDoiLead(rows[0], 'insurance', ev);
    expect(lead).toMatchObject({
      sourceKey: 'insurance:nv:3264218', name: '1 Stop Insurance & Multiservices', city: 'Las Vegas', state: 'NV',
      phone: '(702) 635-4354', email: 'info@onestoplv.com', licenseId: '3264218',
    });
    expect(lead.description).toMatch(/^Listed in the Nevada Division of Insurance licensee list as a licensed insurance producer firm, based in Las Vegas, NV\.$/);
    expect(lead.adjust).toBe(5);
  });

  it('rejects non-agencies, captive agents, expired and contactless rows', () => {
    const why = (i: number) => { const e = evaluateNvDoiRow(rows[i], 'insurance', NOW); return e.keep ? 'KEPT' : e.reason; };
    expect(why(1)).toMatch(/storage/);
    expect(why(2)).toMatch(/carrier-domain/);
    expect(why(3)).toMatch(/expired/);
    expect(why(6)).toMatch(/no email and no phone/);
  });

  it('scores down no-email, free-mail individual and out-of-state rows but keeps them', () => {
    const noEmail = evaluateNvDoiRow(rows[4], 'insurance', NOW);
    expect(noEmail.keep && noEmail.adjust).toBe(-10);
    const person = evaluateNvDoiRow(rows[5], 'insurance', NOW);
    expect(person.keep).toBe(true);
    if (person.keep) expect(person.reasons.join('|')).toMatch(/person name/);
    const oos = evaluateNvDoiRow(rows[7], 'insurance', NOW);
    expect(oos.keep && oos.reasons.join('|')).toMatch(/out of state/);
  });

  it('does not accept a licence type from another vertical', () => {
    const ev = evaluateNvDoiRow(rows[0], 'bailbonds', NOW);
    expect(ev).toMatchObject({ keep: false, reason: 'licence type not in scope' });
  });

  it('streams leads from supplied rows and reports rejects', async () => {
    const r = await streamNvDoiLeads('insurance', { rows, now: NOW });
    expect(r.scanned).toBe(8);
    expect(r.candidates.map((c) => c.sourceKey)).toEqual(['insurance:nv:3264218', 'insurance:nv:333', 'insurance:nv:444', 'insurance:nv:666']);
    expect(r.rejected['licence expired']).toBe(1);
  });

  it('builds the two download URLs and parses M/D/YYYY', () => {
    expect(nvDoiPageUrl('Resident Producer Firm')).toContain('p20_type=Resident+Producer+Firm');
    expect(NV_DOI_CSV_URL).toContain('IR%5Bxlsx%5D_CSV');
    expect(parseNvDate('8/31/2029')?.toISOString()).toBe('2029-08-31T00:00:00.000Z');
    expect(parseNvDate('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('OR workers compensation employer file', () => {
  const base: OrEmployerRow = {
    employer_num: '1000033', legal_business_name: 'ROSE CITY PLUMBING & HEATING LLC', naics: '238220', employees_range: '1-10',
    ppb_city: 'PORTLAND', ppb_state: 'OR', ppb_zip: '97202', insurer_status: '1', liad_end_date: '2027-01-01T00:00:00.000',
    phone_area: '503', phone: '3183732',
  };

  it('joins area code and number into a formatted phone', () => {
    expect(orPhone(base)).toBe('(503) 318-3732');
    expect(orPhone({ phone_area: '503', phone: '' })).toBeNull();
  });

  it('keeps a small active employer and builds an honest lead', () => {
    const ev = evaluateOrEmployerRow(base, NOW);
    expect(ev.keep).toBe(true);
    if (!ev.keep) return;
    const lead = toOrEmployerLead('homeservices', OR_NAICS.homeservices[0], base, ev);
    expect(lead).toMatchObject({ sourceKey: 'homeservices:or:1000033', state: 'OR', city: 'Portland', phone: '(503) 318-3732', licenseId: '1000033' });
    expect(lead.email).toBeUndefined();
    expect(lead.description).toContain('workers’ compensation');
    expect(lead.description).not.toMatch(/licensed (plumber|contractor)/i);
    expect(ev.adjust).toBe(-3 + 2 + 2);
  });

  it('rejects inactive, expired, big, staffing, institutional and chain employers', () => {
    const why = (o: Partial<OrEmployerRow>) => { const e = evaluateOrEmployerRow({ ...base, ...o }, NOW); return e.keep ? 'KEPT' : e.reason; };
    expect(why({ insurer_status: '4' })).toMatch(/not active/);
    expect(why({ liad_end_date: '2026-01-01T00:00:00.000' })).toMatch(/expired/);
    expect(why({ employees_range: '100-499' })).toMatch(/50\+/);
    expect(why({ legal_business_name: 'ACME STAFFING GROUP' })).toMatch(/staffing/);
    expect(why({ legal_business_name: 'LEGACY HEALTH DENTAL' })).toMatch(/institution/);
    expect(why({ legal_business_name: 'ASPEN DENTAL MANAGEMENT' })).toMatch(/chain/);
    expect(why({ legal_business_name: '' })).toMatch(/no employer name/);
  });

  it('keeps a phone-less row but scores it down', () => {
    const e = evaluateOrEmployerRow({ ...base, phone_area: undefined, phone: undefined }, NOW);
    expect(e.keep && e.adjust).toBe(-3 - 5 + 2);
  });

  it('has NAICS classes for every vertical it claims and rotates through them', () => {
    expect(orSupportsVertical('insurance')).toBe(true);
    expect(orSupportsVertical('freight')).toBe(false);
    expect(orClassForDay('homeservices', 0)?.code).toBe('238220');
    expect(orClassForDay('homeservices', 4)?.code).toBe('238210');
    expect(orSourceKey('dental', { employer_num: '55' })).toBe('dental:or:55');
  });
});

// ---------------------------------------------------------------------------
describe('AZ DHS child care layer', () => {
  const row = (o: Partial<AzChildcareRow> = {}): AzChildcareRow => ({
    FACID: '0020284CDCFI56724847', LICENSE_NUMBER: '0020284CDCFI56724847', FACILITY_NAME: 'Little Owls Preschool', Telephone: '6232493211',
    TYPE: 'Child Care Center', Capacity: '54.0', CITY: 'Phoenix', OPERATION_STATUS: 'Active', license_expiration: null, ...o,
  });

  it('keeps an active centre, reads capacity "54.0" as 54 and builds the lead', () => {
    const ev = evaluateAzChildcareRow(row(), NOW);
    expect(ev.keep).toBe(true);
    if (!ev.keep) return;
    // -10 no email, +3 small capacity (54), +6 phone-first
    expect(ev.adjust).toBe(-10 + 3 + 6);
    const lead = toAzChildcareLead(row(), ev);
    expect(lead).toMatchObject({ sourceKey: 'childcare:az:0020284CDCFI56724847', state: 'AZ', city: 'Phoenix', phone: '(623) 249-3211', email: null });
    expect(lead.typeLabel).toBe('licensed child care center');
  });

  it('labels group homes and rejects chains, inactive, expired and phone-less rows', () => {
    const gh = evaluateAzChildcareRow(row({ TYPE: 'Child Care Group Home', Capacity: '8.0' }), NOW);
    expect(gh.keep && gh.typeLabel).toBe('licensed child care group home');
    const why = (o: Partial<AzChildcareRow>) => { const e = evaluateAzChildcareRow(row(o), NOW); return e.keep ? 'KEPT' : e.reason; };
    expect(why({ FACILITY_NAME: 'KinderCare Learning Center #123' })).toMatch(/chain/);
    expect(why({ OPERATION_STATUS: 'Closed' })).toMatch(/not active/);
    expect(why({ license_expiration: Date.parse('2026-01-01') })).toMatch(/expired/);
    expect(why({ Telephone: '' })).toMatch(/no usable phone/);
    expect(why({ LICENSE_NUMBER: '', FACID: '' })).toMatch(/no licence id/);
  });

  it('streams from supplied rows and honours isKnown', async () => {
    const r = await streamAzChildcareLeads({ rows: [row(), row({ LICENSE_NUMBER: 'X2', FACID: 'X2' })], now: NOW, isKnown: (k) => k.endsWith(':X2') });
    expect(r.scanned).toBe(2);
    expect(r.candidates).toHaveLength(1);
    expect(r.rejected['already known']).toBe(1);
  });
});
