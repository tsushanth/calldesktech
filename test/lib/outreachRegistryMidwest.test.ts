import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toMnDliRow, evaluateMnDliRow, toMnDliLead, parseMnDate, MN_COL, streamMnDliLeads,
} from '@/lib/outreach/discovery/mnDliContractors';
import {
  toOhOcilbRow, evaluateOhOcilbRow, toOhOcilbLead, toOhRealEstateRow, evaluateOhRealEstateRow, toOhRealEstateLead,
  cleanRealEstateName, streamOhOcilbLeads, streamOhRealEstateLeads, ocilbSoleProprietor,
} from '@/lib/outreach/discovery/ohElicenseRegistry';
import { hiddenFields, rosterId, recordsFound, credentialSelectName, fetchTylerRoster } from '@/lib/outreach/discovery/tylerRoster';
import {
  evaluateWiRow, toWiLead, fetchWiRows, parseInListings, parseInContact, evaluateInRow, toInLead, streamWiChildcareLeads, streamInChildcareLeads,
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
    <table><tr><th>Facility Number</th><th>Facility Name</th><th>Contact Information</th><th>County</th><th>Provider Type</th><th>PTQ Level</th><th>CCDF Approved?</th><th>On My Way Pre-K Approved?</th><th>Capacity</th></tr>
    <tr><td>RM-1-A</td><td>SOME MINISTRY</td><td>Phone: (260) 000-0000</td><td>ADAMS</td><td>Unlicensed Registered Ministry</td><td></td><td></td><td></td><td></td></tr></table>
    <table><tr><th>Other</th></tr><tr><td>x</td></tr></table>`;

  it('parses the Indiana listing tables, with and without a street address', () => {
    const rows = parseInListings(IN_HTML);
    expect(rows.map((r) => r.facilityNumber)).toEqual(['1101035', 'RM-100434-A', '01-25358', 'RM-1-A']);
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

// ---------------------------------------------------------------------------
// Review additions: caller-phone policy per loader, partial-data guards, key stability.
describe('caller-phone policy (2026-10-01): sole proprietors and home-based providers', () => {
  const mn = (o: Record<string, string> = {}) => {
    const r = toMnDliRow({
      Bus_Pers: 'Business', License_Type: 'Electrical', License_Subtype: 'Class A Electrical Contractor', Name: 'ACME ELECTRIC LLC', DBA_Name: '',
      City: 'Osseo', St: 'MN', Phone_No: '7635652121', Lic_Number: 'EA000001', Status: 'Issued', Exp_Date: '03/29/2028', ...o,
    });
    return toMnDliLead(r, keep(evaluateMnDliRow(r, NOW)));
  };

  it('MN: a person-named licensee or a trade name over a personal legal name is excluded; businesses are not', () => {
    expect(mn().callerPhoneExcluded).toBeNull();
    expect(mn({ Name: 'JAY D RYAN' }).callerPhoneExcluded).toBe('person-named business');
    expect(mn({ Name: 'UDOVICH ANTHONY F', DBA_Name: 'UDOVICH ELECTRIC' }).callerPhoneExcluded).toBe('sole proprietor');
    for (const n of ['NORTHERN CLIMATE CONTROL', 'RIVERCITY REFRIGERATION', 'CITY OF DULUTH', 'PEOPLES ENERGY COOPERATIVE'])
      expect(mn({ Name: n }).callerPhoneExcluded, n).toBeNull();
    // 'Residential Roofer' is a trade, not a home-based provider
    expect(mn({ License_Subtype: 'Residential Roofer Contractor' }).callerPhoneExcluded).toBeNull();
    // facts are kept on an excluded lead
    const x = mn({ Name: 'JAY D RYAN' });
    expect(x.phone).toBe('(763) 565-2121');
    expect(x.licenseId).toBe('EA000001');
  });

  it('MN: one business holding licences in two files yields ONE lead, the lowest licence id, whatever the file order', async () => {
    const hdr = 'Bus_Pers,License_Type,License_Subtype,Name,DBA_Name,Addr1,Addr2,City,St,Zip,Phone_No,Email_Address,Lic_Number,Status,Orig_Date,Exp_Date';
    const filler = Array.from({ length: 600 }, (_, i) => `"Personal","X","Journeyman Plumber","P ${i}","","","","A","MN","","6120000000","","J${i}","Issued","","03/29/2028"`);
    const biz = (sub: string, lic: string) => `"Business","X","${sub}","ACME HEATING & PLUMBING LLC","","1 MAIN","","Osseo","MN","55369","7635652121","","${lic}","Issued","","03/29/2028"`;
    const csv = (rows: string[]) => [hdr, ...filler, ...rows].join('\r\n') + '\r\n';
    const bodies: Record<string, string> = { Electrical: csv([biz('Class A Electrical Contractor', 'EA900')]), Plumbing: csv([biz('Plumbing Contractor', 'PC100')]) };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(bodies[/\/(\w+)\.csv$/.exec(url)![1]], { status: 200 })));
    const fwd = await streamMnDliLeads({ now: NOW, files: ['Electrical', 'Plumbing'], baseUrl: 'https://x.test/' });
    const rev = await streamMnDliLeads({ now: NOW, files: ['Plumbing', 'Electrical'], baseUrl: 'https://x.test/' });
    expect(fwd.errors).toEqual([]);
    expect(fwd.candidates.map((c) => c.sourceKey)).toEqual(['homeservices:mn:EA900']);
    expect(rev.candidates.map((c) => c.sourceKey)).toEqual(['homeservices:mn:EA900']);
    expect(fwd.rejected['same business already listed under another licence']).toBe(1);
  });

  const ocilb = (o: Record<string, string> = {}) => ({
    FormattedCredential: 'EL.10776', Name: 'NORMAN L BODEN', LastName: 'BODEN', Type: 'EL', Status: 'ACTIVE', 'Expiration Date': '12/31/2026', 'Company State': 'OH',
    Company: 'BODEN ELECTRIC', 'Company City': 'Chagrin Falls', 'Company Zip': '44023', 'Company Phone': '440-543-5209', 'Company Email': '', ...o,
  });

  it('OH OCILB: company named for its qualifier with no entity suffix is a sole proprietor; LLC/Inc firms are not', async () => {
    expect(ocilbSoleProprietor(toOhOcilbRow(ocilb()))).toBe(true);
    expect(ocilbSoleProprietor(toOhOcilbRow(ocilb({ Company: 'BODEN ELECTRIC LLC' })))).toBe(false);
    expect(ocilbSoleProprietor(toOhOcilbRow(ocilb({ Company: 'Boyle Mechanical Solutions LLC', Name: 'DAVID R BOYLE', LastName: 'BOYLE' })))).toBe(false);
    expect(ocilbSoleProprietor(toOhOcilbRow(ocilb({ Company: 'RED HAWK HEATING & PLUMBING', Name: 'NATHAN W STEEN', LastName: 'STEEN' })))).toBe(false);
    const res = await streamOhOcilbLeads({ rows: [ocilb(), ocilb({ FormattedCredential: 'EL.2', Company: 'Red Hawk Heating & Plumbing LLC', 'Company Zip': '44111' })] });
    const byKey = Object.fromEntries(res.candidates.map((c) => [c.sourceKey, c]));
    expect(byKey['homeservices:oh:EL.10776'].callerPhoneExcluded).toBe('sole proprietor');
    expect(byKey['homeservices:oh:EL.10776'].phone).toBe('(440) 543-5209');
    expect(byKey['homeservices:oh:EL.2'].callerPhoneExcluded).toBeNull();
  });

  it('OH OCILB: the kept licence per company does not depend on roster row order; stale ACTIVE rows are dropped', async () => {
    const a = ocilb({ FormattedCredential: 'PL.20001', Type: 'PL' });
    const b = ocilb({ FormattedCredential: 'EL.10776' });
    const fwd = await streamOhOcilbLeads({ rows: [a, b], now: NOW });
    const rev = await streamOhOcilbLeads({ rows: [b, a], now: NOW });
    expect(fwd.candidates.map((c) => c.sourceKey)).toEqual(['homeservices:oh:EL.10776']);
    expect(rev.candidates.map((c) => c.sourceKey)).toEqual(['homeservices:oh:EL.10776']);
    const stale = await streamOhOcilbLeads({ rows: [ocilb({ 'Expiration Date': '03/31/2017' }), ocilb({ FormattedCredential: 'EL.3', Status: 'ACTIVE IN RENEWAL', 'Expiration Date': '03/31/2017', Company: 'Other LLC' })], now: NOW });
    expect(stale.candidates.map((c) => c.sourceKey)).toEqual(['homeservices:oh:EL.3']);
  });

  it('OH real estate: Sole Proprietor rows are phone-excluded, brokerage companies are not', () => {
    const mk = (o: Record<string, string>) => {
      const r = toOhRealEstateRow({ Credential: 'REC.1', 'Credential Type': 'Real Estate Company', Status: 'ACTIVE', 'Company Name': 'Vision One Real Estate Advisors, LLC', 'Email Address': 'info@vision1rea.com', City: 'Columbus', State: 'OH', ...o });
      return toOhRealEstateLead(r, keep(evaluateOhRealEstateRow(r)));
    };
    expect(mk({}).callerPhoneExcluded).toBeNull();
    expect(mk({ Credential: 'SOLE.1', 'Credential Type': 'Sole Proprietor', 'Company Name': '', 'First Name': 'Lyle', 'Last Name': 'Bixler', 'Email Address': 'l@gmail.com' }).callerPhoneExcluded).toBe('sole proprietor');
  });

  it('WI and IN: family / home providers are excluded, centers are not, even when the center name is a trade name', () => {
    const wi = (o: Partial<WiChildcareRow>): WiChildcareRow => ({ FacilityNumber: '1', FacilityName: 'BRIGHT BEGINNINGS', LocationPrimaryPhoneNumber: '608-289-3378', City: 'Madison', State: 'WI', CategoryType: 'LICENSED GROUP', Capacity: 40, ...o });
    const lw = (o: Partial<WiChildcareRow>) => toWiLead(wi(o), keep(evaluateWiRow(wi(o))));
    expect(lw({}).callerPhoneExcluded).toBeNull();
    expect(lw({ CategoryType: 'LICENSED FAMILY', FacilityName: 'SUNSHINE KIDS' }).callerPhoneExcluded).toBe('home-based provider');
    expect(lw({ FacilityName: 'DAYCARE ON MAIN', City: 'Madison' }).callerPhoneExcluded).toBeNull();
    const rows = parseInListings(IN_HTML_FOR_POLICY);
    const lead = (i: number) => toInLead(rows[i], keep(evaluateInRow(rows[i])));
    expect(lead(0).callerPhoneExcluded).toBeNull();
    expect(lead(1).callerPhoneExcluded).toBe('home-based provider');
    expect(lead(1).phone).toBe('(260) 701-0528');
  });
});

describe('partial data is never returned as success', () => {
  const T = (rows: string) => `<table><tr><th>Facility Number</th><th>Facility Name</th><th>Contact Information</th><th>County</th><th>Provider Type</th><th>Capacity</th></tr>${rows}</table>`;
  const center = '<tr><td>1</td><td>A CENTER</td><td>Phone: (765) 233-2995</td><td>ADAMS</td><td>Licensed Center</td><td>10</td></tr>';
  const home = '<tr><td>2</td><td>A HOME</td><td>Phone: (765) 233-2996</td><td>ADAMS</td><td>Licensed Home</td><td>10</td></tr>';
  const rm = '<tr><td>RM-3</td><td>A MINISTRY</td><td>Phone: (765) 233-2997</td><td>ADAMS</td><td>Unlicensed Registered Ministry</td><td>10</td></tr>';

  it('IN: throws on a missing table, an unparseable row, or a missing provider type', () => {
    expect(parseInListings(T(center) + T(home) + T(rm))).toHaveLength(3);
    expect(() => parseInListings(T(center) + T(home))).toThrow(/2 of 3/);
    expect(() => parseInListings(T(center + '<tr><td>9</td></tr>') + T(home) + T(rm))).toThrow(/could not be parsed/);
    expect(() => parseInListings(T(center) + T(center) + T(rm))).toThrow(/Licensed Home/);
  });

  it('WI: pages by the server count even when the server caps a page below the requested size', async () => {
    const total = 1200;
    const feat = (i: number) => ({ attributes: { FacilityNumber: String(1000 + i), FacilityName: `K ${i}`, LocationPrimaryPhoneNumber: '608-289-3378', City: 'X', State: 'WI', CategoryType: 'LICENSED GROUP', Capacity: 10 } });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const q = new URL(url).searchParams;
      if (q.get('returnCountOnly')) return Response.json({ count: total });
      const off = Number(q.get('resultOffset'));
      const n = Math.min(400, total - off); // server cap 400 < requested 1000
      return Response.json({ features: Array.from({ length: n }, (_, i) => feat(off + i)), exceededTransferLimit: off + n < total });
    }));
    expect(await fetchWiRows()).toHaveLength(total);
  });

  it('WI: throws when the rows returned do not match the server count', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const q = new URL(url).searchParams;
      if (q.get('returnCountOnly')) return Response.json({ count: 3000 });
      return Response.json({ features: Array.from({ length: Number(q.get('resultOffset')) === 0 ? 700 : 0 }, () => ({ attributes: { FacilityNumber: '1' } })) });
    }));
    await expect(fetchWiRows()).rejects.toThrow(/700 of 3000/);
  });

  it('Tyler: throws when the CSV row count disagrees with "records found", or a type filter has no select to apply to', async () => {
    const mock = (count: number, withSelect: boolean) => vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('GenerateRoster.aspx') && !init.method) return new Response(`<input type="hidden" name="__VIEWSTATE" value="v" />${withSelect ? '<select name="ctl00$MainContentPlaceHolder$ucSearchCriteria1$lbMultipleCredentialTypePrefix"></select>' : ''}`, { status: 200 });
      if (url.endsWith('GenerateRoster.aspx')) return new Response(`<td>${count} records found</td><input RosterIdnt="5" />`, { status: 200 });
      return new Response('Name,Company\r\nA,B\r\nC,D\r\n', { status: 200 });
    }));
    mock(1000, true);
    await expect(fetchTylerRoster({ host: 'e.test' })).rejects.toThrow(/2 rows but the site reports 1000/);
    mock(2, false);
    await expect(fetchTylerRoster({ host: 'e.test', credentialTypeIds: ['44'] })).rejects.toThrow(/credential-type select not found/);
  });
});

const IN_HTML_FOR_POLICY = `<table><tr><th>Facility Number</th><th>Facility Name</th><th>Contact Information</th><th>County</th><th>Provider Type</th><th>Capacity</th></tr>
  <tr><td>1101035</td><td>GROW EARLY LEARNING GENEVA CENTER</td><td>Address: 798 NORTH MAIN STREET, GENEVA, IN 46740Phone: (765) 233-2995</td><td>ADAMS</td><td>Licensed Center</td><td>77</td></tr></table>
  <table><tr><th>Facility Number</th><th>Facility Name</th><th>Contact Information</th><th>County</th><th>Provider Type</th><th>Capacity</th></tr><tr><td>01-25358</td><td>KAYS KIDDOS</td><td>Phone:&nbsp;&nbsp;(260) 701-0528</td><td>ADAMS</td><td>Licensed Home</td><td>12</td></tr></table>
  <table><tr><th>Facility Number</th><th>Facility Name</th><th>Contact Information</th><th>County</th><th>Provider Type</th><th>Capacity</th></tr><tr><td>RM-1</td><td>M</td><td>Phone: (260) 000-0000</td><td>ADAMS</td><td>Unlicensed Registered Ministry</td><td>1</td></tr></table>`;
