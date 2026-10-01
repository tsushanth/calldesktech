import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toMnDliRow, evaluateMnDliRow, toMnDliLead, parseMnDate, MN_COL,
} from '@/lib/outreach/discovery/mnDliContractors';
import {
  toOhOcilbRow, evaluateOhOcilbRow, toOhOcilbLead, toOhRealEstateRow, evaluateOhRealEstateRow, toOhRealEstateLead,
  cleanRealEstateName, streamOhOcilbLeads, streamOhRealEstateLeads,
} from '@/lib/outreach/discovery/ohElicenseRegistry';
import { hiddenFields, rosterId, recordsFound, credentialSelectName, fetchTylerRoster } from '@/lib/outreach/discovery/tylerRoster';
import {
  evaluateWiRow, toWiLead, parseInListings, parseInContact, evaluateInRow, toInLead, streamWiChildcareLeads, streamInChildcareLeads,
  type WiChildcareRow,
} from '@/lib/outreach/discovery/childcareMidwest';

const NOW = new Date('2026-09-30T12:00:00Z');
const keep = <T>(ev: { keep: boolean } | T) => {
  expect((ev as { keep: boolean }).keep, JSON.stringify(ev)).toBe(true);
  return ev as T & { keep: true; adjust: number; reasons: string[]; typeLabel: string };
};

afterEach(() => { vi.unstubAllGlobals(); });

// ---------------------------------------------------------------------------
describe('Minnesota DLI contractor files (homeservices)', () => {
  const base: Record<string, string> = {
    Bus_Pers: 'Business', License_Type: 'Mechanical Contractor Bond', License_Subtype: 'Mechanical Contractor Bond',
    Name: 'OTSEGO HEATING AND AIR CONDITIONING INC', DBA_Name: 'COMFORT SOLUTIONS HEATING AND COOLING',
    City: 'Osseo', St: 'MN', Phone_No: '7635652121', Email_Address: '', Lic_Number: 'MB004953', Status: 'Issued', Exp_Date: '03/29/2028',
  };

  it('keeps an issued HVAC bond holder, prefers the DBA and builds a phone-only lead', () => {
    const r = toMnDliRow(base);
    const lead = toMnDliLead(r, keep(evaluateMnDliRow(r, NOW)));
    expect(lead.sourceKey).toBe('homeservices:mn:MB004953');
    expect(lead.name).toBe('Comfort Solutions Heating And Cooling');
    expect(lead.legalName).toBe('Otsego Heating And Air Conditioning INC');
    expect(lead.phone).toBe('(763) 565-2121');
    expect(lead.email).toBeNull();
    expect(lead.description).toBe('Listed in the Minnesota Department of Labor and Industry licence and registration file as a bonded mechanical (HVAC) contractor, based in Osseo, MN.');
  });

  it('rejects individuals, expired / non-issued licences, other subtypes and rows with no phone', () => {
    const ev = (o: Record<string, string>) => evaluateMnDliRow(toMnDliRow({ ...base, ...o }), NOW);
    expect(ev({ Bus_Pers: 'Personal' })).toMatchObject({ keep: false, reason: 'individual licence, not a business' });
    expect(ev({ Status: 'EXPIRED' })).toMatchObject({ keep: false, reason: 'licence not in issued status' });
    expect(ev({ Exp_Date: '01/01/2020' })).toMatchObject({ keep: false, reason: 'licence expired' });
    expect(ev({ License_Subtype: 'Residential Building Contractor' })).toMatchObject({ keep: false });
    expect(ev({ License_Subtype: 'Registered Electrical Employer' })).toMatchObject({ keep: false });
    expect(ev({ Phone_No: '' })).toMatchObject({ keep: false, reason: 'no contact detail at all' });
    expect(ev({ Name: 'ROTO-ROOTER SERVICES CO', DBA_Name: '' })).toMatchObject({ keep: false, reason: 'national brand, franchise or large industrial contractor name' });
  });

  it('scores a personal-name licensee and an out-of-state firm down', () => {
    const a = keep(evaluateMnDliRow(toMnDliRow({ ...base, License_Subtype: 'Plumbing Contractor', Name: 'JAY D RYAN', DBA_Name: '' }), NOW));
    expect(a.reasons.join(' ')).toMatch(/personal name/);
    const b = keep(evaluateMnDliRow(toMnDliRow({ ...base, St: 'WI' }), NOW));
    expect(b.reasons.join(' ')).toMatch(/out of state/);
    expect(parseMnDate('03/29/2028')?.toISOString()).toBe('2028-03-29T00:00:00.000Z');
    expect(parseMnDate('2028-03-29')).toBeNull();
    expect(MN_COL.email).toBe('Email_Address');
  });
});

// ---------------------------------------------------------------------------
describe('Tyler eLicense roster client', () => {
  it('reads hidden fields, roster id, record count and the credential select name', () => {
    const html = `<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="a&amp;b=" /><input type="hidden" name="__EVENTTARGET" value="" />
      <select name="ctl00$MainContentPlaceHolder$ucSearchCriteria139$lbMultipleCredentialTypePrefix"></select>
      <input RosterIdnt="202271" /> <td>12587 records found</td>`;
    expect(hiddenFields(html)).toEqual({ __VIEWSTATE: 'a&b=', __EVENTTARGET: '' });
    expect(rosterId(html)).toBe('202271');
    expect(recordsFound(html)).toBe(12587);
    expect(credentialSelectName(html)).toBe('ctl00$MainContentPlaceHolder$ucSearchCriteria139$lbMultipleCredentialTypePrefix');
  });

  it('runs generate -> download with the session cookie and parses the CSV', async () => {
    const calls: { url: string; method: string; cookie: string | null; body: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const h = (init.headers ?? {}) as Record<string, string>;
      calls.push({ url, method: init.method ?? 'GET', cookie: h.Cookie ?? null, body: String(init.body ?? '') });
      if (url.endsWith('GenerateRoster.aspx') && !init.method) {
        return new Response('<input type="hidden" name="__VIEWSTATE" value="vs" /><select name="ctl00$MainContentPlaceHolder$ucSearchCriteria1$lbMultipleCredentialTypePrefix"></select>', { status: 200, headers: { 'set-cookie': 'ASP.NET_SessionId=abc; path=/; HttpOnly' } });
      }
      if (url.endsWith('GenerateRoster.aspx')) return new Response('<td>2 records found</td><input RosterIdnt="777" />', { status: 200 });
      return new Response('Name,Company\r\nA B,"ACME, INC"\r\nC D,BEE LLC\r\n', { status: 200 });
    }));
    const rows = await fetchTylerRoster({ host: 'elicense.test', credentialTypeIds: ['44', '61'] });
    expect(rows).toEqual([{ Name: 'A B', Company: 'ACME, INC' }, { Name: 'C D', Company: 'BEE LLC' }]);
    expect(calls[1].method).toBe('POST');
    expect(calls[1].cookie).toBe('ASP.NET_SessionId=abc');
    expect(calls[1].body).toContain('ckbRoster0=on');
    expect(calls[1].body).toContain('lbMultipleCredentialTypePrefix=44');
    expect(calls[1].body).toContain('lbMultipleCredentialTypePrefix=61');
    expect(calls[2].url).toBe('https://elicense.test/Lookup/FileDownload.aspx?Idnt=777&Type=Comma');
  });

  it('throws when the download is an HTML page', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('GenerateRoster.aspx') && !init.method) return new Response('<input type="hidden" name="__VIEWSTATE" value="v" />', { status: 200 });
      if (url.endsWith('GenerateRoster.aspx')) return new Response('<input RosterIdnt="1" />', { status: 200 });
      return new Response('<!DOCTYPE html><html>login</html>', { status: 200 });
    }));
    await expect(fetchTylerRoster({ host: 'elicense.test' })).rejects.toThrow(/HTML, not CSV/);
  });
});

// ---------------------------------------------------------------------------
describe('Ohio OCILB roster (homeservices)', () => {
  const row = (o: Record<string, string> = {}) => ({
    FormattedCredential: 'EL.10776', Name: 'NORMAN L BODEN', Type: 'EL', Status: 'ACTIVE', 'Company State': 'OH',
    Company: 'BODEN ELECTRIC', 'Company City': 'Chagrin Falls', 'Company Zip': '44023-1630', 'Company Phone': '440-543-5209', 'Company Email': '', ...o,
  });

  it('turns a qualifier row into a company lead with the person as contactName', () => {
    const r = toOhOcilbRow(row());
    const lead = toOhOcilbLead(r, keep(evaluateOhOcilbRow(r)));
    expect(lead.sourceKey).toBe('homeservices:oh:EL.10776');
    expect(lead.name).toBe('Boden Electric');
    expect(lead.contactName).toBe('Norman L Boden');
    expect(lead.phone).toBe('(440) 543-5209');
    expect(lead.description).toBe('Listed in the Ohio Construction Industry Licensing Board licensee roster as a licensed electrical contractor, based in Chagrin Falls, OH.');
  });

  it('rejects training agencies, no-contact rows, big brands and keeps a business-domain email', () => {
    const ev = (o: Record<string, string>) => evaluateOhOcilbRow(toOhOcilbRow(row(o)));
    expect(ev({ Type: 'TA' })).toMatchObject({ keep: false });
    expect(ev({ 'Company Phone': '' })).toMatchObject({ keep: false, reason: 'no contact detail at all' });
    expect(ev({ Company: 'JOHNSON CONTROLS INC' })).toMatchObject({ keep: false });
    const r = toOhOcilbRow(row({ 'Company Email': 'office@bodenelectric.com' }));
    expect(toOhOcilbLead(r, keep(evaluateOhOcilbRow(r))).email).toBe('office@bodenelectric.com');
    const g = toOhOcilbRow(row({ 'Company Email': 'boden@gmail.com' }));
    expect(toOhOcilbLead(g, keep(evaluateOhOcilbRow(g))).email).toBeNull();
  });

  it('keeps one lead per company even when it holds several trade licences', async () => {
    const rows = [
      row(), row({ FormattedCredential: 'PL.20001', Type: 'PL', Name: 'SECOND QUALIFIER' }),
      row({ FormattedCredential: 'HV.30001', Type: 'HV', Company: 'Other Co', 'Company Zip': '44111' }),
    ];
    const res = await streamOhOcilbLeads({ rows });
    expect(res.scanned).toBe(3);
    expect(res.candidates.map((c) => c.sourceKey)).toEqual(['homeservices:oh:EL.10776', 'homeservices:oh:HV.30001']);
    expect(res.rejected['same company already listed under another licence']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('Ohio Division of Real Estate roster (realestate)', () => {
  const row = (o: Record<string, string> = {}) => ({
    Credential: 'REC.0000413330', 'Credential Type': 'Real Estate Company', Status: 'ACTIVE', 'Company Name': '$2100$ Realty Sellers Choice, Inc.',
    'First Name': '', 'Last Name': '', City: 'Avon', State: 'OH', 'Email Address': 'info@2100realty.com', ...o,
  });

  it('cleans the $-wrapped sort marker and builds an email lead without a phone', () => {
    expect(cleanRealEstateName('$2100$ Realty Sellers Choice, Inc.')).toBe('2100$ Realty Sellers Choice, Inc.'.replace('2100$', '2100'));
    const r = toOhRealEstateRow(row());
    const lead = toOhRealEstateLead(r, keep(evaluateOhRealEstateRow(r)));
    expect(lead.sourceKey).toBe('realestate:oh:REC.0000413330');
    expect(lead.email).toBe('info@2100realty.com');
    expect(lead.phone).toBeNull();
    expect(lead.description).toContain('as a licensed real estate brokerage, based in Avon, OH');
  });

  it('keeps a free-mail contact but scores it down, and scores sole proprietors lower', () => {
    const free = keep(evaluateOhRealEstateRow(toOhRealEstateRow(row({ 'Email Address': 'blaine@gmail.com' }))));
    const biz = keep(evaluateOhRealEstateRow(toOhRealEstateRow(row())));
    expect(free.adjust).toBeLessThan(biz.adjust);
    const sole = toOhRealEstateRow(row({ 'Credential Type': 'Sole Proprietor', 'Company Name': '', 'First Name': 'JANE', 'Last Name': 'DOE', Credential: 'SOLE.1' }));
    const lead = toOhRealEstateLead(sole, keep(evaluateOhRealEstateRow(sole)));
    expect(lead.name).toBe('Jane Doe');
    expect(lead.contactName).toBe('Jane Doe');
  });

  it('rejects inactive, branch offices, franchise brands and rows without an email', async () => {
    const rows = [
      row(), row({ Credential: 'BBB.1', 'Credential Type': 'Real Estate Branch Office' }), row({ Credential: 'REC.2', Status: 'INACTIVE' }),
      row({ Credential: 'REC.3', 'Company Name': 'Keller Williams Realty Co' }), row({ Credential: 'REC.4', 'Email Address': '' }),
    ];
    const res = await streamOhRealEstateLeads({ rows });
    expect(res.candidates).toHaveLength(1);
    expect(Object.keys(res.rejected).sort()).toEqual([
      'credential type is not a brokerage company or sole-proprietor broker',
      'licence not active',
      'national real estate brand or franchise name',
      'no contact detail at all (roster has no phone column)',
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('Wisconsin and Indiana child care (childcare)', () => {
  const wi = (o: Partial<WiChildcareRow> = {}): WiChildcareRow => ({
    FacilityNumber: '1009252', FacilityName: 'KIDS CLUB                    ', LocationContactFullName: 'NYMAN, LISA', LocationPrimaryPhoneNumber: '608-289-3378',
    City: 'Belleville     ', State: 'WI', CategoryType: 'LICENSED GROUP', Capacity: 45, ...o,
  });

  it('builds a WI lead from a licensed group row (trimmed padding, last-first contact)', () => {
    const lead = toWiLead(wi(), keep(evaluateWiRow(wi())));
    expect(lead.sourceKey).toBe('childcare:wi:1009252');
    expect(lead.name).toBe('Kids Club');
    expect(lead.contactName).toBe('Lisa Nyman');
    expect(lead.phone).toBe('(608) 289-3378');
    expect(lead.description).toBe('Listed in the Wisconsin Department of Children and Families child care provider listing as a licensed group child care center, based in Belleville, WI.');
  });

  it('skips certified and school programmes, chains and phone-less rows in WI', async () => {
    expect(evaluateWiRow(wi({ CategoryType: 'REGULAR CERTIFIED' }))).toMatchObject({ keep: false });
    expect(evaluateWiRow(wi({ CategoryType: 'PUBLIC SCHOOL PROGRAM' }))).toMatchObject({ keep: false });
    expect(evaluateWiRow(wi({ FacilityName: 'KinderCare Learning Center' }))).toMatchObject({ keep: false });
    expect(evaluateWiRow(wi({ LocationPrimaryPhoneNumber: null }))).toMatchObject({ keep: false, reason: 'no contact detail at all' });
    const res = await streamWiChildcareLeads({ rows: [wi(), wi()] });
    expect(res.candidates).toHaveLength(1);
    expect(res.rejected['duplicate facility number']).toBe(1);
  });

  const IN_HTML = `<table><tr><th>Facility Number</th><th>Facility Name</th><th>Contact Information</th><th>County</th><th>Provider Type</th><th>PTQ Level</th><th>CCDF Approved?</th><th>On My Way Pre-K Approved?</th><th>Capacity</th></tr>
    <tr><td>1101035</td><td>GROW EARLY LEARNING GENEVA CENTER</td><td><b>Address:</b> 798 NORTH MAIN STREET, GENEVA, IN 46740<br><b>Phone:</b>&nbsp;&nbsp;(765) 233-2995</td><td>ADAMS</td><td>Licensed Center</td><td>Level 4</td><td>Yes</td><td>No</td><td>77</td></tr>
    <tr><td>RM-100434-A</td><td>BOUNDLESS CHILDCARE</td><td>Address: 6555 N PIQUA RD, DECATUR, IN 46733Phone: (260) 724-2047</td><td>ADAMS</td><td>Unlicensed Registered Ministry</td><td></td><td></td><td></td><td></td></tr></table>
    <table><tr><th>Facility Number</th><th>Facility Name</th><th>Contact Information</th><th>County</th><th>Provider Type</th><th>PTQ Level</th><th>CCDF Approved?</th><th>On My Way Pre-K Approved?</th><th>Capacity</th></tr>
    <tr><td>01-25358</td><td>KAYS KIDDOS</td><td>Phone:&nbsp;&nbsp;(260) 701-0528</td><td>ADAMS</td><td>Licensed Home</td><td>Level 0</td><td>No</td><td>No</td><td>12</td></tr></table>
    <table><tr><th>Other</th></tr><tr><td>x</td></tr></table>`;

  it('parses the Indiana listing tables, with and without a street address', () => {
    const rows = parseInListings(IN_HTML);
    expect(rows.map((r) => r.facilityNumber)).toEqual(['1101035', 'RM-100434-A', '01-25358']);
    expect(parseInContact(rows[0].contact)).toEqual({ phone: '(765) 233-2995', city: 'GENEVA', zip: '46740' });
    expect(parseInContact(rows[2].contact)).toEqual({ phone: '(260) 701-0528', city: null, zip: null });
  });

  it('keeps licensed centers and homes, skips ministries, and falls back to the county for homes', async () => {
    const rows = parseInListings(IN_HTML);
    const center = toInLead(rows[0], keep(evaluateInRow(rows[0])));
    expect(center.sourceKey).toBe('childcare:in:1101035');
    expect(center.description).toContain('as a licensed child care center, based in Geneva, IN');
    const home = toInLead(rows[2], keep(evaluateInRow(rows[2])));
    expect(home.location).toBe('Adams County, IN');
    expect(home.adjust).toBeGreaterThan(center.adjust); // capacity 12 -> +6 vs 77 -> 0
    expect(evaluateInRow(rows[1])).toMatchObject({ keep: false });
    const res = await streamInChildcareLeads({ rows });
    expect(res.candidates).toHaveLength(2);
    expect(res.candidates.every((c) => c.email === null && c.phone)).toBe(true);
  });
});
