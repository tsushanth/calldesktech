import { describe, it, expect } from 'vitest';
import { parseCsv, unwrapCell, rowToObject, CsvRowParser } from '@/lib/outreach/discovery/csvStream';
import {
  toFlDfsRow, evaluateFlDfsRow, toFlDfsLead, findFlDfsCandidates, TYCL_AGENCY, TYCL_BAIL_BOND, type FlDfsRow,
} from '@/lib/outreach/discovery/flDfsRegistry';
import {
  parseDeAddress, collapseDeByCompany, deCompanyKey, evaluateDeRow, toDeLead, deTypeLabel,
  evaluateMoRow, toMoLead, type DeRow, type MoRow,
} from '@/lib/outreach/discovery/septicDelawareMissouri';
import { septicSourceForSlot } from '@/lib/outreach/discovery/septicRegistry';
import { evaluateMocoRow, toMocoLead, type MocoRow } from '@/lib/outreach/discovery/towingMontgomeryMd';
import {
  cleanContractorName, evaluateWaContractor, toWaContractorLead, type WaContractorRow,
} from '@/lib/outreach/discovery/homeservicesRegistry';
import {
  evaluateNppesRow, toNppesLead, locationAddress, citiesForRun, findDentalNppesCandidates, type NppesResult,
} from '@/lib/outreach/discovery/dentalNppes';
import {
  evaluateCmsRow, toCmsLead, evaluateMoHomeRow, toMoHomeLead, collapseMoHomeRows, type CmsRow, type MoHomeRow,
} from '@/lib/outreach/discovery/homecareCmsMissouri';
import { homecareSourceForDay } from '@/lib/outreach/discovery/homecareRegistry';
import { homeservices, dental, insurance, bailbonds } from '@/lib/outreach/products';

const NOW = new Date('2026-09-24T12:00:00Z');
const keep = (ev: { keep: boolean }) => { expect(ev.keep, JSON.stringify(ev)).toBe(true); return ev as { keep: true; adjust: number; reasons: string[] }; };

// ---------------------------------------------------------------------------
describe('streaming CSV reader', () => {
  it('handles quoted commas, escaped quotes, embedded newlines and CRLF', () => {
    const rows = parseCsv('a,b,c\r\n"x,1","he said ""hi""","two\nlines"\r\nlast,,z');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x,1', 'he said "hi"', 'two\nlines'],
      ['last', '', 'z'],
    ]);
  });
  it('produces the same rows however the input is chunked', () => {
    const text = 'h1,h2\n"a,1","b\n2"\nc,d\n';
    const p = new CsvRowParser();
    const rows: string[][] = [];
    for (const ch of text) rows.push(...p.feed(ch));
    const last = p.end();
    if (last) rows.push(last);
    expect(rows).toEqual(parseCsv(text));
  });
  it('unwraps the Excel formula-guard cells used by the FL DFS export', () => {
    expect(unwrapCell('="7410936"')).toBe('7410936');
    expect(unwrapCell('  ="336141579" ')).toBe('336141579');
    expect(unwrapCell('TAMPA')).toBe('TAMPA');
    expect(unwrapCell(undefined)).toBe('');
    expect(rowToObject(['A', 'B'], ['="1"', 'x'])).toEqual({ A: '1', B: 'x' });
  });
});

// ---------------------------------------------------------------------------
// One header line plus real-shaped rows from the FL DFS bulk export.
const FL_HEADER = '"License Number","Full Name","NPN Number","Residency Type","License TYCL","License TYCL Desc","License Status","License Issue Date","Email Address","Business Phone","Business Address1","Business Address2","Business City","Business State","Business Zip","Business County","Mailing Address","Mailing Address2","Mailing City","Mailing State","Mailing Zip"';
const flCsv = (...lines: string[]) => [FL_HEADER, ...lines].join('\r\n');
const BAIL_LINE = 'A123456,ACME BAIL BONDS INC,="7410936",Resident,="2405",BAIL BOND AGENCY LICENSE,VALID,9/12/2002 12:00:00 AM,INFO@ACMEBAIL.COM,="8139330677",100 MAIN ST,,TAMPA,FL,="33614",Hillsborough,100 MAIN ST,,TAMPA,FL,="33614"';
const AGENCY_LINE = 'L998877,"HARBOR POINT INSURANCE AGENCY, LLC",="222222",Resident,="2105",AGENCY LICENSE,VALID,1/2/2015 12:00:00 AM,team@harborpointins.com,="9045551212",42 BAY ST,,JACKSONVILLE,FL,="32202",Duval,,,,,';

function flRow(line: string): FlDfsRow {
  const rows = parseCsv(flCsv(line));
  return toFlDfsRow(rowToObject(rows[0].map((h) => unwrapCell(h)), rows[1]));
}

describe('Florida DFS licensee file (insurance + bailbonds)', () => {
  it('parses a bail bond agency row, unwrapping the guarded cells', () => {
    const r = flRow(BAIL_LINE);
    expect(r).toMatchObject({
      licenseNumber: 'A123456', name: 'ACME BAIL BONDS INC', npn: '7410936',
      tycl: TYCL_BAIL_BOND, tyclDesc: 'BAIL BOND AGENCY LICENSE', status: 'VALID',
      email: 'INFO@ACMEBAIL.COM', phone: '8139330677', city: 'TAMPA', state: 'FL', zip: '33614',
    });
  });
  it('builds a bailbonds lead that says licensee file, not registry, and carries the email', () => {
    const r = flRow(BAIL_LINE);
    const ev = keep(evaluateFlDfsRow(r, 'bailbonds'));
    const lead = toFlDfsLead(r, 'bailbonds', ev);
    expect(lead.sourceKey).toBe('bailbonds:fl:A123456');
    expect(lead.description).toBe('Listed in the Florida Department of Financial Services licensee file as a licensed bail bond agency, based in Tampa, FL.');
    expect(lead.description).not.toMatch(/registry/);
    expect(lead.email).toBe('info@acmebail.com');
    expect(lead.contactSourceUrl).toMatch(/licenseesearch\.fldfs\.com/);
    expect(lead.phone).toBe('(813) 933-0677');
    expect(ev.reasons.join(' ')).toMatch(/\+5: business-domain email/);
  });
  it('builds an insurance lead from an AGENCY LICENSE row', () => {
    const r = flRow(AGENCY_LINE);
    expect(r.tycl).toBe(TYCL_AGENCY);
    const lead = toFlDfsLead(r, 'insurance', keep(evaluateFlDfsRow(r, 'insurance')));
    expect(lead.sourceKey).toBe('insurance:fl:L998877');
    expect(lead.name).toBe('Harbor Point Insurance Agency, LLC');
    expect(lead.description).toMatch(/licensee file as a licensed insurance agency, based in Jacksonville, FL/);
    expect(lead.email).toBe('team@harborpointins.com');
  });
  it('rejects the wrong licence type, non-VALID rows, out-of-state and national carriers', () => {
    const bail = flRow(BAIL_LINE);
    expect(evaluateFlDfsRow(bail, 'insurance')).toEqual({ keep: false, reason: 'licence type not in scope' });
    expect(evaluateFlDfsRow({ ...bail, status: 'REVOKED' }, 'bailbonds')).toEqual({ keep: false, reason: 'licence not valid' });
    expect(evaluateFlDfsRow({ ...bail, state: 'GA' }, 'bailbonds')).toEqual({ keep: false, reason: 'business address not in Florida' });
    const agency = flRow(AGENCY_LINE);
    expect(evaluateFlDfsRow({ ...agency, name: 'STATE FARM INSURANCE AGENCY' }, 'insurance'))
      .toEqual({ keep: false, reason: 'captive/national carrier or large brokerage name' });
    expect(evaluateFlDfsRow({ ...agency, name: 'SUNSHINE HOME WARRANTY LLC' }, 'insurance'))
      .toEqual({ keep: false, reason: 'warranty/title/adjusting firm' });
  });
  it('rejects a captive agent whose own name hides it but whose email is on the carrier domain', () => {
    const agency = flRow(AGENCY_LINE);
    expect(evaluateFlDfsRow({ ...agency, name: 'TONY PEARSON INSURANCE AGENCY, INC.', email: 'tony.pearson.cf5t@statefarm.com' }, 'insurance'))
      .toEqual({ keep: false, reason: 'carrier-domain email (captive agent)' });
    expect(keep(evaluateFlDfsRow({ ...agency, email: 'tony@pearsonagencyfl.com' }, 'insurance')).adjust).toBe(5);
  });
  it('scores a missing or free-mail contact down', () => {
    const r = flRow(AGENCY_LINE);
    const free = keep(evaluateFlDfsRow({ ...r, email: 'sunshineagency@gmail.com' }, 'insurance'));
    expect(free.adjust).toBe(-5);
    const none = keep(evaluateFlDfsRow({ ...r, email: null }, 'insurance'));
    expect(none.adjust).toBe(-10);
    expect(toFlDfsLead({ ...r, email: null }, 'insurance', none).email).toBeNull();
    expect(toFlDfsLead({ ...r, email: null }, 'insurance', none).contactSourceUrl).toBeNull();
  });
  it('caps a run at max, rotates the window by day, and skips leads we already hold', async () => {
    const rows: FlDfsRow[] = Array.from({ length: 50 }, (_, i) => ({ ...flRow(AGENCY_LINE), licenseNumber: `L${1000 + i}`, name: `AGENCY ${i} LLC` }));
    const a = await findFlDfsCandidates('insurance', 5, { rowsOverride: rows, now: NOW });
    expect(a.candidates).toHaveLength(5);
    expect(a.scanned).toBe(50);
    const nextDay = await findFlDfsCandidates('insurance', 5, { rowsOverride: rows, now: new Date(NOW.getTime() + 86_400_000) });
    expect(nextDay.candidates.map((c) => c.sourceKey)).not.toEqual(a.candidates.map((c) => c.sourceKey));
    const known = new Set(a.candidates.map((c) => c.sourceKey));
    const b = await findFlDfsCandidates('insurance', 5, { rowsOverride: rows, now: NOW, isKnown: (k) => known.has(k) });
    expect(b.candidates.some((c) => known.has(c.sourceKey))).toBe(false);
    expect(b.rejected['already known']).toBe(5);
  });
});

// ---------------------------------------------------------------------------
const DE_HAULER: DeRow = {
  displayname: 'Smith, John ', licensenumber: '2011F2', licensesubtype: 'Class F (Liquid Waste)', licstatus: 'Approved',
  companyname: 'Weaver Sanitation LLC', companyaddress: '20 Duck Creek Road, Smyrna, DE 19977 US',
  companyphone: '(302) 653-8777', companyemailaddress: 'office@weaversanitation.com',
};

describe('Delaware on-site wastewater licensees (septic)', () => {
  it('parses the single-string company address', () => {
    expect(parseDeAddress('344 Skeeter Neck Road, Frederica, DE 19946 US')).toEqual({ city: 'Frederica', state: 'DE' });
    expect(parseDeAddress('PO Box 1, DE 19977')).toEqual({ city: null, state: 'DE' });
    expect(parseDeAddress(undefined)).toEqual({ city: null, state: null });
  });
  it('makes a lead with the business-domain email as the contact', () => {
    const ev = keep(evaluateDeRow(DE_HAULER));
    const lead = toDeLead(DE_HAULER, ev);
    expect(lead.sourceKey).toBe('septic:de:weaversanitationllc');
    expect(lead.email).toBe('office@weaversanitation.com');
    expect(lead.contactSourceUrl).toMatch(/data\.delaware\.gov/);
    expect(lead.location).toBe('Smyrna, DE');
    expect(lead.description).toMatch(/licensed on-site wastewater professionals list as a licensed liquid waste hauler/);
    expect(ev.adjust).toBe(5);
  });
  it('does NOT use a personal free-mail address as the contact (website discovery instead)', () => {
    const personal = { ...DE_HAULER, companyemailaddress: 'daustin122@aol.com' };
    const lead = toDeLead(personal, keep(evaluateDeRow(personal)));
    expect(lead.email).toBeNull();
    expect(lead.contactSourceUrl).toBeNull();
  });
  it('keeps only contractor/hauler subtypes and approved licences', () => {
    expect(evaluateDeRow({ ...DE_HAULER, licensesubtype: 'Class I (Construction Inspector)' }))
      .toEqual({ keep: false, reason: 'licence subtype is not a contractor or hauler' });
    expect(evaluateDeRow({ ...DE_HAULER, licstatus: 'Expired' })).toEqual({ keep: false, reason: 'licence not approved' });
    expect(evaluateDeRow({ ...DE_HAULER, companyname: '' })).toEqual({ keep: false, reason: 'no company name (individual only)' });
    expect(deTypeLabel('Class E (System Contractor)')).toBe('licensed on-site wastewater system contractor');
  });
  it('collapses the per-person rows to one per company, preferring the business email', () => {
    const rows: DeRow[] = [
      { ...DE_HAULER, licensenumber: '1', companyemailaddress: 'someone@yahoo.com' },
      { ...DE_HAULER, licensenumber: '2', companyemailaddress: 'office@weaversanitation.com' },
      { ...DE_HAULER, licensenumber: '3', companyname: 'Other Septic Co', companyemailaddress: '' },
    ];
    const out = collapseDeByCompany(rows);
    expect(out).toHaveLength(2);
    expect(out.find((r) => deCompanyKey(r) === 'weaversanitationllc')?.companyemailaddress).toBe('office@weaversanitation.com');
  });
});

describe('Missouri OWTS installers (septic)', () => {
  const MO: MoRow = { business: 'Snider Construction LLC', city: 'Lebanon', state: 'MO', business_phone: '(417) 288-1265', installer_id: '37774', installer_level: 'Basic', date_of_expiration: '2027-05-31T00:00:00.000' };
  it('keeps a current registration and words the description as a registry listing', () => {
    const lead = toMoLead(MO, keep(evaluateMoRow(MO, NOW)));
    expect(lead.sourceKey).toBe('septic:mo:37774');
    expect(lead.phone).toBe('(417) 288-1265');
    expect(lead.description).toBe('Listed in the Missouri Department of Health and Senior Services registry as a registered on-site wastewater system installer, based in Lebanon, MO.');
    expect(lead.email).toBeUndefined();
  });
  it('drops expired registrations and keeps the out-of-state ones with their own state', () => {
    expect(evaluateMoRow({ ...MO, date_of_expiration: '2025-01-31T00:00:00.000' }, NOW)).toEqual({ keep: false, reason: 'registration expired' });
    const ks = { ...MO, state: 'KS', city: 'Overland Park' };
    expect(toMoLead(ks, keep(evaluateMoRow(ks, NOW))).location).toBe('Overland Park, KS');
  });
  it('rotates the four septic sources by hourly slot', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(septicSourceForSlot)).toEqual(['fl', 'fl', 'de', 'atx', 'fl', 'fl', 'de', 'mo']);
  });
});

// ---------------------------------------------------------------------------
describe('Montgomery County MD tow companies (towing)', () => {
  const MOCO: MocoRow = {
    corporation_name: 'QUICK TOW INC.', trade_name: 'QUICK TOW INC dba CONGRESSIONAL TOWING AND TRANSPORT INC',
    business_address: '7406 H Westmore Road', city: 'Rockville', state: 'MD', zip: '20850',
    business_tel_no: '(301) 908-1213', registration_no: '26-MT-013895', expire_date: '2027-01-25T00:00:00.000',
  };
  it('prefers the DBA name and keeps the corporation as the legal name', () => {
    const lead = toMocoLead(MOCO, keep(evaluateMocoRow(MOCO, NOW)));
    expect(lead.name).toBe('Congressional Towing And Transport INC');
    expect(lead.legalName).toBe('Quick Tow INC.');
    expect(lead.sourceKey).toBe('towing:md:26-MT-013895');
    expect(lead.description).toBe('Listed in the Montgomery County, Maryland registry as a licensed tow company, based in Rockville, MD.');
  });
  it('drops expired registrations, dealerships and dispatch networks', () => {
    expect(evaluateMocoRow({ ...MOCO, expire_date: '2025-01-25T00:00:00.000' }, NOW)).toEqual({ keep: false, reason: 'registration expired' });
    expect(evaluateMocoRow({ ...MOCO, corporation_name: 'CRISWELL NISSAN', trade_name: 'CRISWELL NISSAN TOWING' }, NOW))
      .toEqual({ keep: false, reason: 'car dealership, not a tow operator' });
    expect(evaluateMocoRow({ ...MOCO, trade_name: 'AGERO TOWING' }, NOW)).toEqual({ keep: false, reason: 'insurer/auction/network name' });
  });
  it('scores a missing phone down', () => {
    expect(keep(evaluateMocoRow({ ...MOCO, business_tel_no: '' }, NOW)).adjust).toBe(-5);
  });
});

// ---------------------------------------------------------------------------
describe('WA L&I contractors (homeservices)', () => {
  const WA: WaContractorRow = {
    businessname: '!ROOFTECH INC', contractorlicensenumber: 'ROOFTI*882DZ', contractorlicensetypecodedesc: 'SPECIALTY CONTRACTOR',
    specialtycode1desc: 'ROOFING', specialtycode2desc: '', address1: '1 A ST', city: 'DES MOINES', state: 'WA', zip: '98198',
    phonenumber: '2068512194', ubi: '1', primaryprincipalname: 'SMITH, JO', contractorlicensestatus: 'ACTIVE',
  };
  it('strips the sort-hack prefix from the business name', () => {
    expect(cleanContractorName('!ECO STAR C G CONSTRUCTION LLC')).toBe('ECO STAR C G CONSTRUCTION LLC');
    expect(cleanContractorName('#A1 PLUMBING')).toBe('A1 PLUMBING');
    expect(cleanContractorName(null)).toBe('');
  });
  it('labels the trade from the licence type or either specialty column', () => {
    expect(keep(evaluateWaContractor(WA)).typeLabel).toBe('registered roofing contractor');
    const hvacSecond = { ...WA, specialtycode1desc: 'ELECTRICAL', specialtycode2desc: 'HVAC/RFRG' };
    expect(keep(evaluateWaContractor(hvacSecond)).typeLabel).toBe('registered HVAC/refrigeration contractor');
    const plumbing = { ...WA, contractorlicensetypecodedesc: 'PLUMBING CONTRACTOR', specialtycode1desc: '', specialtycode2desc: '' };
    expect(keep(evaluateWaContractor(plumbing)).typeLabel).toBe('registered plumbing contractor');
  });
  it('rejects general construction, inactive registrations and national brands', () => {
    expect(evaluateWaContractor({ ...WA, contractorlicensetypecodedesc: 'CONSTRUCTION CONTRACTOR', specialtycode1desc: 'GENERAL' }))
      .toEqual({ keep: false, reason: 'trade not HVAC/plumbing/electrical/roofing' });
    expect(evaluateWaContractor({ ...WA, contractorlicensestatus: 'EXPIRED' })).toEqual({ keep: false, reason: 'registration not active' });
    expect(evaluateWaContractor({ ...WA, businessname: 'ROTO-ROOTER SERVICES COMPANY', specialtycode1desc: 'PLUMBING' }))
      .toEqual({ keep: false, reason: 'national brand or franchise name' });
  });
  it('builds a lead with the registry wording and no email', () => {
    const lead = toWaContractorLead(WA, keep(evaluateWaContractor(WA)));
    expect(lead.sourceKey).toBe('homeservices:wa:ROOFTI*882DZ');
    expect(lead.name).toBe('Rooftech INC');
    expect(lead.description).toBe('Listed in the Washington State Department of Labor & Industries registry as a registered roofing contractor, based in Des Moines, WA.');
    expect(lead.email).toBeUndefined();
    expect(lead.phone).toBe('(206) 851-2194');
  });
});

// ---------------------------------------------------------------------------
const npi = (over: Partial<NppesResult> = {}): NppesResult => ({
  number: '1679187686', enumeration_type: 'NPI-2',
  basic: { organization_name: '316 FAMILY DENTAL LLC', status: 'A', organizational_subpart: 'NO' },
  addresses: [
    { address_purpose: 'MAILING', address_1: 'PO BOX 9', city: 'WICHITA', state: 'KS', postal_code: '67201', telephone_number: '316-111-1111' },
    { address_purpose: 'LOCATION', address_1: '1 N MAIN', city: 'NEWTON', state: 'KS', postal_code: '67114', telephone_number: '316-283-0110' },
  ],
  taxonomies: [{ desc: 'Dentist - General Practice', primary: true }],
  ...over,
});

describe('NPPES organisation NPIs (dental)', () => {
  it('uses the LOCATION address, not the mailing one', () => {
    expect(locationAddress(npi())?.city).toBe('NEWTON');
    const lead = toNppesLead(npi(), keep(evaluateNppesRow(npi())));
    expect(lead.location).toBe('Newton, KS');
    expect(lead.phone).toBe('(316) 283-0110');
    expect(lead.sourceKey).toBe('dental:npi:1679187686');
    expect(lead.description).toMatch(/NPI registry as a dental practice with an organisational NPI, based in Newton, KS/);
    expect(lead.email).toBeUndefined();
  });
  it('rejects subparts, deactivated NPIs, DSOs, institutions and non-dental taxonomies', () => {
    expect(evaluateNppesRow(npi({ basic: { organization_name: 'X DENTAL', status: 'A', organizational_subpart: 'YES' } })))
      .toEqual({ keep: false, reason: 'organisational subpart, not an independent practice' });
    expect(evaluateNppesRow(npi({ basic: { organization_name: 'X DENTAL', status: 'D', organizational_subpart: 'NO' } })))
      .toEqual({ keep: false, reason: 'NPI not active' });
    expect(evaluateNppesRow(npi({ basic: { organization_name: 'ASPEN DENTAL MANAGEMENT INC', status: 'A', organizational_subpart: 'NO' } })))
      .toEqual({ keep: false, reason: 'DSO or corporate dental chain name' });
    expect(evaluateNppesRow(npi({ basic: { organization_name: 'UNIVERSITY OF KANSAS SCHOOL OF DENTISTRY', status: 'A', organizational_subpart: 'NO' } })))
      .toEqual({ keep: false, reason: 'institution (university/hospital/government)' });
    expect(evaluateNppesRow(npi({ taxonomies: [{ desc: 'Physical Therapist' }] }))).toEqual({ keep: false, reason: 'taxonomy is not dental' });
  });
  it('rotates metros day by day and never asks one city twice in a run', () => {
    const a = citiesForRun(NOW, 3);
    const b = citiesForRun(new Date(NOW.getTime() + 86_400_000), 3);
    expect(a).toHaveLength(3);
    expect(new Set(a.map((c) => c.city)).size).toBe(3);
    expect(a).not.toEqual(b);
    expect(a[0]).toMatchObject({ city: expect.any(String), state: expect.any(String) });
  });
  it('walks cities until max candidates, skipping known practices, and records per-city errors', async () => {
    const calls: string[] = [];
    const res = await findDentalNppesCandidates(2, {
      now: NOW,
      cities: [{ city: 'Austin', state: 'TX' }, { city: 'Dallas', state: 'TX' }],
      isKnown: (k) => k === 'dental:npi:1679187686',
      fetchCity: async (city) => {
        calls.push(city);
        if (city === 'Austin') throw new Error('boom');
        return [npi(), npi({ number: '2' }), npi({ number: '3' }), npi({ number: '4' })];
      },
    });
    expect(calls).toEqual(['Austin', 'Dallas']);
    expect(res.errors[0]).toMatch(/dental nppes Austin, TX: boom/);
    expect(res.candidates.map((c) => c.licenseId)).toEqual(['2', '3']);
    expect(res.rejected['already known']).toBe(1);
  }, 10_000);
});

// ---------------------------------------------------------------------------
describe('CMS home health + Missouri home health (homecare)', () => {
  const CMS: CmsRow = {
    provider_name: 'HOME & HEART HEALTHCARE', address: '1 A ST', citytown: 'SUN VALLEY', state: 'CA',
    zip_code: '91352', telephone_number: '8189844321', cms_certification_number_ccn: '757239', type_of_ownership: 'PROPRIETARY',
  };
  it('says the agency is Medicare-certified and listed in the CMS dataset, not a state registry', () => {
    const lead = toCmsLead(CMS, keep(evaluateCmsRow(CMS)));
    expect(lead.sourceKey).toBe('homecare:cms:757239');
    expect(lead.description).toBe('Listed in the CMS Medicare Home Health Compare dataset as a Medicare-certified home health agency, based in Sun Valley, CA.');
    expect(lead.description).not.toMatch(/registry|licen[cs]/i);
    expect(lead.phone).toBe('(818) 984-4321');
  });
  it('prefers proprietary agencies and drops hospital-based or government ones', () => {
    expect(keep(evaluateCmsRow(CMS)).reasons.join(' ')).toMatch(/\+5: proprietary/);
    expect(evaluateCmsRow({ ...CMS, type_of_ownership: 'GOVERNMENT - COUNTY' })).toEqual({ keep: false, reason: 'hospital-based, facility-based or government agency' });
    expect(evaluateCmsRow({ ...CMS, type_of_ownership: 'HOSPITAL BASED PROGRAM' })).toEqual({ keep: false, reason: 'hospital-based, facility-based or government agency' });
    expect(keep(evaluateCmsRow({ ...CMS, type_of_ownership: 'VOLUNTARY NON-PROFIT - PRIVATE' })).reasons.join(' ')).toMatch(/-5: voluntary non-profit/);
    expect(evaluateCmsRow({ ...CMS, provider_name: 'MERCY HOSPITAL HOME CARE', type_of_ownership: 'PROPRIETARY' }))
      .toEqual({ keep: false, reason: 'institution (hospital/system/university/government)' });
  });
  it('collapses the Missouri per-county rows to one lead per licence', () => {
    const rows: MoHomeRow[] = [
      { facname: 'Adoration Home Health', city: 'Sikeston', state: 'MO', phone: '5734722234', licnumber: '966-HH', licyrexpires: '2026-11-30T00:00:00.000' },
      { facname: 'Adoration Home Health', city: 'Sikeston', state: 'MO', phone: '5734722234', licnumber: '966-HH', licyrexpires: '2026-11-30T00:00:00.000' },
      { facname: 'Hometown Homecare', city: 'Fayette', state: 'MO', phone: '6602482100', licnumber: '106-42HH', licyrexpires: '2027-01-31T00:00:00.000' },
    ];
    const collapsed = collapseMoHomeRows(rows);
    expect(collapsed).toHaveLength(2);
    const lead = toMoHomeLead(collapsed[0], keep(evaluateMoHomeRow(collapsed[0], NOW)));
    expect(lead.sourceKey).toBe('homecare:mo:966-HH');
    expect(lead.description).toMatch(/Missouri Department of Health and Senior Services registry as a licensed home health agency/);
  });
  it('drops expired Missouri licences and institutional names', () => {
    const expired: MoHomeRow = { facname: 'X Home Care', licnumber: '1-HH', licyrexpires: '2024-01-01T00:00:00.000' };
    expect(evaluateMoHomeRow(expired, NOW)).toEqual({ keep: false, reason: 'licence expired' });
    const hospital: MoHomeRow = { facname: 'County Memorial Hospital Home Health', licnumber: '2-HH', licyrexpires: '2027-01-01T00:00:00.000' };
    expect(evaluateMoHomeRow(hospital, NOW).keep).toBe(false);
  });
  it('rotates the four homecare sources by day', () => {
    expect([0, 1, 2, 3, 4].map(homecareSourceForDay)).toEqual(['il', 'cms', 'ny', 'mo', 'il']);
  });
});

// ---------------------------------------------------------------------------
describe('registryFact wording for the newly registry-backed verticals', () => {
  it('still allows the own-website wording and adds the registry wording for each', () => {
    // registryFact is only visible through the draft prompt it is spliced into.
    for (const p of [homeservices, dental, insurance, bailbonds]) {
      expect(p.systemPrompt).toMatch(/from its own website/);
      expect(p.systemPrompt).toMatch(/worded exactly as the lead data words it/);
      expect(p.systemPrompt).toMatch(/never both/);
    }
    expect(insurance.systemPrompt).toMatch(/Florida Department of Financial Services licensee file as a licensed insurance agency/);
    expect(bailbonds.systemPrompt).toMatch(/licensee file as a licensed bail bond agency/);
    expect(homeservices.systemPrompt).toMatch(/Labor & Industries registry as a registered plumbing contractor/);
    expect(dental.systemPrompt).toMatch(/NPI registry as a dental practice/);
  });
});
