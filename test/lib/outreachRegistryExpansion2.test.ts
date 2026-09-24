import { describe, it, expect, vi, afterEach } from 'vitest';
import { TabRowParser, findHeader, mapRow, streamDelimitedRows } from '@/lib/outreach/discovery/delimitedStream';
import {
  evaluateNycDobRow, toNycDobLead, boroughFromBbl, type NycDobRow,
} from '@/lib/outreach/discovery/nycDobLicenses';
import {
  toVaDporRow, evaluateVaDporRow, toVaDporLead, parseVaDate, vaFileForDay, vaDporUrl, VA_COL,
} from '@/lib/outreach/discovery/vaDporContractors';
import {
  toArContractorRow, evaluateArContractorRow, toArContractorLead, stripArClassSuffix, parseArDate, AR_COL,
} from '@/lib/outreach/discovery/arkansasContractors';
import {
  toCaCdphRow, evaluateCaCdphRow, toCaCdphLead, caFacTypesForDay, CA_COL,
} from '@/lib/outreach/discovery/homecareCaCdph';
import {
  evaluateTxEmployerRow, toTxEmployerLead, txSourceKey, txSupportsVertical, txClassForDay, parseTxDate, TX_NAICS,
} from '@/lib/outreach/discovery/txWorkersComp';
import {
  homeservicesSourceForSlot, homecareSourceForSlot, useTxForSlot, findHomeservicesCandidates,
} from '@/lib/outreach/discovery/registryRotation';
import { homeservices, homecare, dental } from '@/lib/outreach/products';

const NOW = new Date('2026-09-24T12:00:00Z');
const keep = <T>(ev: { keep: boolean } | T) => {
  expect((ev as { keep: boolean }).keep, JSON.stringify(ev)).toBe(true);
  return ev as T & { keep: true; adjust: number; reasons: string[] };
};

afterEach(() => { vi.unstubAllGlobals(); });

// ---------------------------------------------------------------------------
describe('delimited stream reader', () => {
  it('splits tab rows and gives the same result however the input is chunked', () => {
    const text = 'a\tb\tc\r\n1\t\t3\nx\ty\tz\n';
    const whole = new TabRowParser();
    const rows = whole.feed(text);
    expect(whole.end()).toBeNull();
    expect(rows).toEqual([['a', 'b', 'c'], ['1', '', '3'], ['x', 'y', 'z']]);

    const piecewise = new TabRowParser();
    const out: string[][] = [];
    for (const ch of text) out.push(...piecewise.feed(ch));
    const last = piecewise.end();
    if (last) out.push(last);
    expect(out).toEqual(rows);
  });

  it('treats a quote as an ordinary character in a tab file', () => {
    // Virginia writes 'SAM"S HVAC' unquoted; the CSV reader would swallow it.
    expect(new TabRowParser().feed('SAM"S HVAC\tRICHMOND\n')).toEqual([['SAM"S HVAC', 'RICHMOND']]);
  });

  it('returns a trailing row that has no final newline', () => {
    const p = new TabRowParser();
    expect(p.feed('a\tb')).toEqual([]);
    expect(p.end()).toEqual(['a', 'b']);
  });

  it('finds the header by column name and ignores case', () => {
    expect(findHeader(['ID', 'Name', 'Email'], ['id', 'email'])).toEqual(['ID', 'Name', 'Email']);
    expect(findHeader(['CLB Roster Export - 09-24-2026'], ['ID', 'Email'])).toBeNull();
  });

  it('maps a short row, trimming values and filling missing columns', () => {
    expect(mapRow(['A', 'B', 'C'], ['  x ', 'y'])).toEqual({ A: 'x', B: 'y', C: '' });
  });
});

function stubBody(text: string) {
  const bytes = new TextEncoder().encode(text);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob([bytes]).stream(), { status: 200 })));
}

describe('streamDelimitedRows', () => {
  it('skips the title and blank lines before the Arkansas header and visits data rows only', async () => {
    stubBody('CLB Roster Export - 09-24-2026\n\n"ID","Name","Email"\n"1-C","ACME HVAC","a@acme.com"\n"2-R","BEE PLUMBING","b@bee.com"\n');
    const seen: Record<string, string>[] = [];
    const { scanned } = await streamDelimitedRows({
      url: 'https://example.test/roster.csv', delimiter: 'comma', requiredColumns: ['ID', 'Email'], minRows: 1,
      onRow: (o) => { seen.push(o); },
    });
    expect(scanned).toBe(2);
    expect(seen.map((o) => o.Name)).toEqual(['ACME HVAC', 'BEE PLUMBING']);
  });

  it('stops early when the visitor returns false', async () => {
    stubBody('ID\tEmail\n1\ta@b.com\n2\tc@d.com\n3\te@f.com\n');
    const seen: string[] = [];
    await streamDelimitedRows({
      url: 'https://example.test/x.txt', delimiter: 'tab', requiredColumns: ['ID'], minRows: 1,
      onRow: (o) => { seen.push(o.ID); return seen.length < 2; },
    });
    expect(seen).toEqual(['1', '2']);
  });

  it('throws when the header columns are missing (layout change) or the file is short', async () => {
    stubBody('SOMETHING,ELSE\n1,2\n');
    await expect(streamDelimitedRows({
      url: 'https://example.test/x.csv', delimiter: 'comma', requiredColumns: ['ID', 'Email'], onRow: () => {},
    })).rejects.toThrow(/header row with ID, Email not found/);

    stubBody('ID,Email\n1,a@b.com\n');
    await expect(streamDelimitedRows({
      url: 'https://example.test/x.csv', delimiter: 'comma', requiredColumns: ['ID'], minRows: 50, onRow: () => {},
    })).rejects.toThrow(/only 1 rows/);
  });

  it('throws on a non-200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
    await expect(streamDelimitedRows({
      url: 'https://example.test/x.csv', delimiter: 'comma', requiredColumns: ['ID'], onRow: () => {},
    })).rejects.toThrow(/HTTP 503/);
  });
});

// ---------------------------------------------------------------------------
// Real-shaped rows from data.cityofnewyork.us/resource/t8hj-ruu2.json.
const NYC_PLUMBER: NycDobRow = {
  license_sl_no: '12322', license_type: 'MASTER PLUMBER', license_number: '1189',
  last_name: 'GUGLIELMO', first_name: 'GERARD', business_name: "GERARD'S PLBG & HTG CORP",
  business_house_number: '1041', business_street_name: 'EAST 46TH STREET', business_state: 'NY',
  business_zip_code: '11203', business_email: 'GERARD@GERADSPLUMBING.COM',
  business_phone_number: '7182523813', license_status: 'ACTIVE', bbl: '3050230043',
};
const NYC_FREEMAIL: NycDobRow = {
  ...NYC_PLUMBER, license_sl_no: '25395', license_number: '1907', business_name: 'FERKO PLUMBING & HEATING',
  business_email: 'FERKOPLUMBING@GMAIL.COM', business_phone_number: '2123801232', bbl: '4041230011',
};
const NYC_FIRM: NycDobRow = {
  license_sl_no: '90001', license_type: 'ELECTRICAL FIRM', license_number: 'E-4412',
  business_name: 'BRIGHT STAR ELECTRIC LLC', business_state: 'NY', business_zip_code: '10467',
  business_email: 'office@brightstarelec.com', business_phone_number: '(718) 231-2639',
  license_status: 'ACTIVE', bbl: '2033340022',
};

describe('NYC DOB licence info (homeservices)', () => {
  it('derives the borough from the BBL because the city column is truncated', () => {
    expect(boroughFromBbl('3050230043')).toBe('Brooklyn');
    expect(boroughFromBbl('1001530001')).toBe('Manhattan');
    expect(boroughFromBbl('4041230011')).toBe('Queens');
    expect(boroughFromBbl('')).toBeNull();
    expect(boroughFromBbl('305023')).toBeNull();
  });

  it('builds a master plumber lead whose wording does not call the company a licensed plumber', () => {
    const ev = keep(evaluateNycDobRow(NYC_PLUMBER));
    const lead = toNycDobLead(NYC_PLUMBER, ev);
    expect(lead.sourceKey).toBe('homeservices:nyc:mp-1189');
    expect(lead.description).toBe("Listed in the New York City Department of Buildings licence file as a business listed against an active master plumber licence, based in Brooklyn, NY.");
    expect(lead.email).toBe('gerard@geradsplumbing.com');
    expect(lead.contactSourceUrl).toMatch(/t8hj-ruu2/);
    expect(lead.phone).toBe('(718) 252-3813');
    expect(ev.reasons.join(' ')).toMatch(/\+5: business-domain email/);
  });

  it('keeps a free-mail row but does not use the address as the contact', () => {
    const ev = keep(evaluateNycDobRow(NYC_FREEMAIL));
    const lead = toNycDobLead(NYC_FREEMAIL, ev);
    expect(lead.email).toBeNull();
    expect(lead.contactSourceUrl).toBeNull();
    expect(ev.reasons.join(' ')).toMatch(/free-mail address/);
    expect(ev.adjust).toBeLessThan(0);
  });

  it('builds an electrical firm lead and separates the two licence types in the source key', () => {
    const ev = keep(evaluateNycDobRow(NYC_FIRM));
    const lead = toNycDobLead(NYC_FIRM, ev);
    expect(lead.sourceKey).toBe('homeservices:nyc:ef-E-4412');
    expect(lead.description).toContain('as a licensed electrical firm, based in Bronx, NY');
    expect(lead.email).toBe('office@brightstarelec.com');
  });

  it('rejects non-active licences, other licence types, agencies and nameless rows', () => {
    expect(evaluateNycDobRow({ ...NYC_PLUMBER, license_status: 'EXPIRED' })).toMatchObject({ keep: false, reason: 'licence not active' });
    expect(evaluateNycDobRow({ ...NYC_PLUMBER, license_status: 'RETIRED' })).toMatchObject({ keep: false });
    expect(evaluateNycDobRow({ ...NYC_PLUMBER, license_type: 'GENERAL CONTRACTOR' })).toMatchObject({ keep: false, reason: 'licence type not in scope' });
    expect(evaluateNycDobRow({ ...NYC_PLUMBER, business_name: 'DEPT OF BUILDINGS' })).toMatchObject({ keep: false, reason: 'agency, institution or large mechanical/utility firm' });
    // Found by the live dry run: the city writes the agency as "DEP OF".
    expect(evaluateNycDobRow({ ...NYC_PLUMBER, business_name: 'NYC DEP OF TRANSPORTATION' })).toMatchObject({ keep: false, reason: 'agency, institution or large mechanical/utility firm' });
    // ...but a real local business that merely has NYC in its name is kept.
    expect(evaluateNycDobRow({ ...NYC_PLUMBER, business_name: 'NYC DRAIN & SEWER CORP' })).toMatchObject({ keep: true });
    expect(evaluateNycDobRow({ ...NYC_PLUMBER, business_name: '' })).toMatchObject({ keep: false, reason: 'no business name' });
  });
});

// ---------------------------------------------------------------------------
// One header line plus real-shaped rows from 2705b__crnt.txt / 2701__crnt.txt.
const VA_HEADER = ['BOARD', 'OCCUPATION', 'CERTIFICATE #', 'INDIVIDUAL NAME', 'BUSINESS NAME', 'FIRST LINE ADDRESS', 'SECOND LINE ADDRESS', 'P O BOX #', 'CITY', 'STATE', 'FIVE DIGIT ZIP CODE', 'ZIP CODE EXTENSION', 'PROVINCE', 'COUNTRY', 'POSTAL CODE', 'EXPIRATION DATE', 'CERTIFICATION DATE', 'LICENSE RANK', 'LICENSE SPECIALTY', 'EMAILADDRESS'];
const vaRow = (line: string) => toVaDporRow(mapRow(VA_HEADER, new TabRowParser().feed(`${line}\n`)[0]));

const VA_HVAC = '27\t05\t000028\t\tMARK W BRYANT\t14304 FRANKLIN TURNPIKE\t\t\tDRY FORK\tVA\t24549\t0000\t\t\t\t02/28/2027\t02/06/1991\tB\tHVA \tacinstr@aol.com';
const VA_PLUMBING = '27\t05\t195395\t\tALAN S PLUMBING INC\t1561 W MAIN ST\t\t\tSALEM\tVA\t24153\t0000\t\t\t\t07/31/2028\t06/01/2019\tC\tPLB ELE \toffice@alansplumbing.com';
const VA_GENERIC = '27\t05\t155550\t\tCLOVER GLASS SHOP  INC.\t1119 ALVERSER DRIVE\t\t\tMIDLOTHIAN\tVA\t23113\t0000\t\t\t\t06/30/2027\t06/04/2015\tC\tRBC CBC \tldcloverglass@gmail.com';
const VA_ROOF_NAMED = '27\t05\t000010\t\tBRADY M FURROW ROOFING\t4243 MOUNTAINVIEW RD\t\t\tROANOKE\tVA\t24017\t0000\t\t\t\t01/31/2027\t01/30/1991\tB\tHIC ASB \tbradyroofingva@gmail.com';
const VA_ENGINEER = '27\t05\t175352\t\tWOOD GROUP USA INC\t17325 PARK ROW\t\t\tHOUSTON\tTX\t77084\t0000\t\t\t\t04/30/2027\t04/06/2021\tA\tEMC H/H \tlicensing@woodplc.com';

describe('Virginia DPOR contractor licence files (homeservices)', () => {
  it('parses the tab columns, the space-padded specialty list and the MM/DD/YYYY expiry', () => {
    const r = vaRow(VA_PLUMBING);
    expect(r).toMatchObject({
      occupation: '05', certificate: '195395', name: 'ALAN S PLUMBING INC',
      city: 'SALEM', state: 'VA', zip: '24153', rank: 'C', email: 'office@alansplumbing.com',
    });
    expect(r.specialties).toEqual(['PLB', 'ELE']);
    expect(parseVaDate('07/31/2028')?.toISOString()).toBe('2028-07-31T00:00:00.000Z');
    expect(parseVaDate('')).toBeNull();
    expect(parseVaDate('2028-07-31')).toBeNull();
  });

  it('asserts the trade only when the specialty code says so', () => {
    const plumbing = toVaDporLead(vaRow(VA_PLUMBING), keep(evaluateVaDporRow(vaRow(VA_PLUMBING), NOW)));
    expect(plumbing.sourceKey).toBe('homeservices:va:05-195395');
    expect(plumbing.description).toBe('Listed in the Virginia Department of Professional and Occupational Regulation contractor licence file as a licensed plumbing contractor, based in Salem, VA.');
    expect(plumbing.email).toBe('office@alansplumbing.com');
    expect(plumbing.phone).toBeNull();

    const hvac = toVaDporLead(vaRow(VA_HVAC), keep(evaluateVaDporRow(vaRow(VA_HVAC), NOW)));
    expect(hvac.description).toContain('as a licensed HVAC contractor, based in Dry Fork, VA');
    // aol.com is free mail: kept as a signal, never as the contact.
    expect(hvac.email).toBeNull();
  });

  it('keeps a generic-class row only on a trade-like name, and then stays generic in wording', () => {
    expect(evaluateVaDporRow(vaRow(VA_GENERIC), NOW)).toMatchObject({ keep: false, reason: 'specialty is not an HVAC/plumbing/electrical/roofing trade' });
    const ev = keep(evaluateVaDporRow(vaRow(VA_ROOF_NAMED), NOW));
    expect(ev.typeLabel).toBe('licensed contractor');
    const lead = toVaDporLead(vaRow(VA_ROOF_NAMED), ev);
    expect(lead.description).toContain('as a licensed contractor');
    expect(lead.description).not.toMatch(/roofing/i);
  });

  it('rejects expired licences and large engineering firms', () => {
    expect(evaluateVaDporRow(vaRow(VA_HVAC), new Date('2030-01-01T00:00:00Z'))).toMatchObject({ keep: false, reason: 'licence expired' });
    expect(evaluateVaDporRow(vaRow(VA_ENGINEER), NOW)).toMatchObject({ keep: false });
    // Found by the live dry run under the ELE specialty.
    const big = (name: string) => evaluateVaDporRow({ ...vaRow(VA_PLUMBING), name }, NOW);
    expect(big('OTIS ELEVATOR COMPANY')).toMatchObject({ keep: false });
    expect(big('PARSONS TRANSPORTATION GROUP INC')).toMatchObject({ keep: false });
    // A common surname must not be collateral damage.
    expect(big('PARSONS PLUMBING LLC')).toMatchObject({ keep: true });
    expect(big('JACOBS HEATING & AIR')).toMatchObject({ keep: true });
  });

  it('scores by the licence rank and the state, which the file records itself', () => {
    const at = (rank: string, state = 'VA') => keep(evaluateVaDporRow({ ...vaRow(VA_PLUMBING), rank, state }, NOW));
    expect(at('C').adjust).toBeGreaterThan(at('B').adjust);
    expect(at('B').adjust).toBeGreaterThan(at('A').adjust);
    expect(at('A').reasons.join(' ')).toMatch(/unlimited-value contractor/);
    expect(at('C', 'NJ').adjust).toBeLessThan(at('C', 'VA').adjust);
    expect(at('C', 'NJ').reasons.join(' ')).toMatch(/based out of state/);
  });

  it('rotates the four class files and builds their URLs', () => {
    expect([0, 1, 2, 3, 4].map(vaFileForDay)).toEqual(['2701', '2705a', '2705b', '2705c', '2701']);
    expect(vaFileForDay(-1)).toBe('2705c');
    expect(vaDporUrl('2705a')).toContain('Regulant%20List/2705a__crnt.txt');
    expect(VA_COL.email).toBe('EMAILADDRESS');
  });
});

// ---------------------------------------------------------------------------
// Real-shaped rows from latestroster.csv.
const AR_HEADER = ['ID', 'CommResid', 'Name', 'DBA', 'Address', 'City', 'State', 'Zip', 'Email', 'Country', 'Phone', 'Restricted Projects Under 750000', 'Bid Limit', 'license', 'Div Comment', 'Exp', 'Class Desc', 'Spec', 'Style', 'Registration', 'Temporary', 'County', 'Officers'];
const arRow = (cells: Partial<Record<string, string>>) => toArContractorRow(mapRow(AR_HEADER, AR_HEADER.map((h) => cells[h] ?? '')));

const AR_HVAC = { ID: '1-C', CommResid: 'C', Name: 'A & N ELECTRIC INC-C', City: 'MORRILTON', State: 'AR', Zip: '72110', Email: 'jasongoodwin@outlook.com', Phone: '870-304-7865', Exp: '01-31-2027', Spec: 'Heating, Ventilation, Air Conditioning, Refrigeration' };
const AR_ROOF = { ID: '9042-R', CommResid: 'R', Name: 'SUMMIT ROOFING LLC-R', City: 'CONWAY', State: 'AR', Zip: '72034', Email: 'office@summitroofingar.com', Phone: '(501) 555-1212', Exp: '06-30-2027', Spec: 'Roofing, Roof Decks, Roofing Sheet Metal' };
const AR_NO_SPEC = { ID: '5511-C', Name: 'DELTA PLUMBING CO-C', City: 'MEMPHIS', State: 'TN', Zip: '38103', Email: 'info@deltaplumbingco.com', Phone: '9015551000', Exp: '03-31-2027' };
const AR_CONCRETE = { ID: '7000-C', Name: 'OZARK CONCRETE INC-C', City: 'ROGERS', State: 'AR', Email: 'a@b.com', Exp: '03-31-2027', Spec: 'Concrete' };

describe('Arkansas Contractors Licensing Board roster (homeservices)', () => {
  it('strips the commercial/residential suffix and parses the MM-DD-YYYY expiry', () => {
    expect(stripArClassSuffix('A & N ELECTRIC INC-C')).toBe('A & N ELECTRIC INC');
    expect(stripArClassSuffix('SUMMIT ROOFING LLC -R')).toBe('SUMMIT ROOFING LLC');
    expect(stripArClassSuffix('C & R MECHANICAL')).toBe('C & R MECHANICAL');
    expect(parseArDate('01-31-2027')?.toISOString()).toBe('2027-01-31T00:00:00.000Z');
    expect(parseArDate('2027-01-31')).toBeNull();
  });

  it('words the trade from the roster specialty, not from the business name', () => {
    const r = arRow(AR_HVAC);
    const ev = keep(evaluateArContractorRow(r, NOW));
    const lead = toArContractorLead(r, ev);
    expect(lead.sourceKey).toBe('homeservices:ar:1-C');
    // The name says ELECTRIC; the roster specialty says HVAC, and the roster wins.
    expect(lead.description).toBe('Listed in the Arkansas Contractors Licensing Board contractor roster as a licensed HVAC contractor, based in Morrilton, AR.');
    expect(lead.name).toBe('A & N Electric INC');
    // outlook.com is free mail.
    expect(lead.email).toBeNull();
    expect(lead.phone).toBe('(870) 304-7865');
  });

  it('uses a business-domain roster email as the contact', () => {
    const r = arRow(AR_ROOF);
    const lead = toArContractorLead(r, keep(evaluateArContractorRow(r, NOW)));
    expect(lead.email).toBe('office@summitroofingar.com');
    expect(lead.description).toContain('as a licensed roofing contractor, based in Conway, AR');
  });

  it('keeps an out-of-state licensee, notes the state and scores it down', () => {
    const r = arRow(AR_NO_SPEC);
    const ev = keep(evaluateArContractorRow(r, NOW));
    const lead = toArContractorLead(r, ev);
    expect(lead.state).toBe('TN');
    expect(lead.location).toBe('Memphis, TN');
    expect(ev.reasons.join(' ')).toMatch(/based out of state/);
    // No specialty recorded: filtered in on the name, described generically.
    expect(lead.description).toContain('as a licensed contractor');
    expect(lead.description).not.toMatch(/plumbing/i);
  });

  it('rejects non-trade specialties and expired licences', () => {
    expect(evaluateArContractorRow(arRow(AR_CONCRETE), NOW)).toMatchObject({ keep: false, reason: 'specialty is not an HVAC/plumbing/electrical/roofing trade' });
    expect(evaluateArContractorRow(arRow({ ...AR_HVAC, Exp: '01-31-2020' }), NOW)).toMatchObject({ keep: false, reason: 'licence expired' });
    // Found by the live dry run: a manpower company licensed under Electrical.
    expect(evaluateArContractorRow(arRow({ ...AR_HVAC, Name: 'CORBIN MANPOWER SOLUTIONS, LLC-C', Spec: 'Electrical' }), NOW)).toMatchObject({ keep: false, reason: 'staffing, manpower or payroll company' });
    expect(AR_COL.spec).toBe('Spec');
  });
});

// ---------------------------------------------------------------------------
// Real-shaped rows from health_facility_locations.csv.
const CA_HEADER = [CA_COL.facId, CA_COL.facName, CA_COL.businessName, CA_COL.facType, CA_COL.facStatus, CA_COL.address, CA_COL.city, CA_COL.zip, CA_COL.county, CA_COL.email, CA_COL.phone, CA_COL.admin, CA_COL.npi, CA_COL.licenseNumber, CA_COL.licenseStatus];
const caRow = (cells: Partial<Record<string, string>>) => toCaCdphRow(mapRow(CA_HEADER, CA_HEADER.map((h) => cells[h] ?? '')));

const CA_INDEPENDENT = {
  FACID: '060000123', FACNAME: 'VALLEY CARE HOME HEALTH', BUSINESS_NAME: 'VALLEY CARE HOME HEALTH INC',
  FAC_TYPE_CODE: 'HHA', FAC_STATUS_TYPE_CODE: 'OPEN', CITY: 'FRESNO', ZIP: '93720', COUNTY_NAME: 'FRESNO',
  CONTACT_EMAIL: 'ADMIN@VALLEYCAREHH.COM', CONTACT_PHONE_NUMBER: '(559) 555-2020', FACADMIN: 'ORTEGA, MARIA',
  NPI: '1234567890', LICENSE_NUMBER: '060000123', LICENSE_STATUS_DESCRIPTION: 'ACTIVE',
};
const CA_KAISER = {
  ...CA_INDEPENDENT, FACID: '010000008', FACNAME: 'KAISER FOUNDATION HOSPITAL HOME HEALTH-VALLEJO',
  BUSINESS_NAME: 'KAISER FOUNDATION HOSPITALS', CITY: 'VALLEJO', COUNTY_NAME: 'SOLANO',
  CONTACT_EMAIL: 'ERIN.L.BROWN@KP.ORG', LICENSE_NUMBER: '010000008',
};
const CA_HOSPICE = { ...CA_INDEPENDENT, FACID: '070000555', FACNAME: 'SUNRISE HOSPICE CARE', BUSINESS_NAME: '', FAC_TYPE_CODE: 'HOSPICE', LICENSE_NUMBER: '070000555', CONTACT_EMAIL: 'info@sunrisehospicecare.com' };

describe('California CDPH licensed facility file (homecare)', () => {
  it('words the description as the licensed facility file, not a registry', () => {
    const r = caRow(CA_INDEPENDENT);
    const ev = keep(evaluateCaCdphRow(r));
    const lead = toCaCdphLead(r, ev);
    expect(lead.sourceKey).toBe('homecare:ca:060000123');
    expect(lead.description).toBe('Listed in the California Department of Public Health licensed facility file as a home health agency, based in Fresno, CA.');
    expect(lead.description).not.toMatch(/registry/);
    expect(lead.email).toBe('admin@valleycarehh.com');
    expect(lead.phone).toBe('(559) 555-2020');
    expect(lead.legalName).toBe('Valley Care Home Health INC');
    expect(lead.signalDetail).toContain('Fresno County');
  });

  it('scores a health-system agency far below an independent one', () => {
    const indep = keep(evaluateCaCdphRow(caRow(CA_INDEPENDENT)));
    const kaiser = evaluateCaCdphRow(caRow(CA_KAISER));
    // classifyHomecareName rejects the "hospital" in the name outright; if it
    // ever stops doing so, the health-system penalty must still apply.
    if (kaiser.keep) {
      expect(kaiser.adjust).toBeLessThan(indep.adjust - 15);
      expect(kaiser.reasons.join(' ')).toMatch(/large health system/);
    } else {
      expect(kaiser.reason).toMatch(/institution/);
    }
    const sutter = evaluateCaCdphRow(caRow({ ...CA_INDEPENDENT, FACNAME: 'SUTTER CARE AT HOME', BUSINESS_NAME: 'SUTTER HEALTH' }));
    expect(keep(sutter).reasons.join(' ')).toMatch(/large health system or national home-health chain/);
  });

  it('labels a hospice as a hospice', () => {
    const r = caRow(CA_HOSPICE);
    const lead = toCaCdphLead(r, keep(evaluateCaCdphRow(r)));
    expect(lead.description).toContain('licensed facility file as a hospice, based in Fresno, CA');
    expect(lead.legalName).toBeNull();
  });

  it('rejects closed facilities, inactive licences and other facility types', () => {
    expect(evaluateCaCdphRow(caRow({ ...CA_INDEPENDENT, FAC_STATUS_TYPE_CODE: 'CLOSED' }))).toMatchObject({ keep: false, reason: 'facility not open' });
    expect(evaluateCaCdphRow(caRow({ ...CA_INDEPENDENT, LICENSE_STATUS_DESCRIPTION: 'CLOSED' }))).toMatchObject({ keep: false, reason: 'licence not active' });
    expect(evaluateCaCdphRow(caRow({ ...CA_INDEPENDENT, FAC_TYPE_CODE: 'SNF' }))).toMatchObject({ keep: false, reason: 'facility type not in scope' });
  });

  it('gives hospices one run in four', () => {
    expect([0, 1, 2, 3].map((d) => caFacTypesForDay(d)[0])).toEqual(['HHA', 'HHA', 'HHA', 'HOSPICE']);
  });
});

// ---------------------------------------------------------------------------
// Real-shaped rows from data.texas.gov/resource/c4xz-httr.json.
const TX_DENTIST = {
  record_type: 'E', insured_employer_name: 'ALLRED & GERMAN DDS PC', insured_employer_address: '3635 EASTEX FWY',
  insured_employer_city: 'BEAUMONT', insured_employer_state: 'TX', insured_employer_zip: '77706',
  sic_code_naics_code: '621210', governing_class_code: '8832',
  policy_effective_date: '2026-08-01T00:00:00.000', policy_expiration_date: '2027-08-01T00:00:00.000',
  coverage_provider_name: 'TEXAS MUTUAL INSURANCE CO',
};

describe("Texas workers' compensation subscriber file (six verticals)", () => {
  it('claims only the NAICS class and the coverage, never a trade licence', () => {
    const ev = keep(evaluateTxEmployerRow(TX_DENTIST, NOW));
    const lead = toTxEmployerLead('dental', TX_NAICS.dental[0], TX_DENTIST, ev);
    expect(lead.description).toBe('Listed in the Texas Department of Insurance, Division of Workers’ Compensation workers’ compensation subscriber file as a business with active workers’ compensation coverage in the "offices of dentists" NAICS class, based in Beaumont, TX.');
    expect(lead.description).not.toMatch(/licen[cs]e/i);
    expect(lead.phone).toBeNull();
    expect(lead.email).toBeUndefined();
    expect(lead.licenseId).toBe('621210');
    expect(ev.reasons.join(' ')).toMatch(/no phone or email in the subscriber file/);
  });

  it('keys on the employer name and zip because the file has no licence number', () => {
    expect(txSourceKey('dental', TX_DENTIST)).toBe('dental:tx:allredgermanddspc-77706');
    expect(txSourceKey('septic', { insured_employer_name: 'A-1 Septic, LLC', insured_employer_zip: '78610-1234' })).toBe('septic:tx:a1septicllc-78610');
  });

  it('rejects expired policies, PEOs, institutions and national chains', () => {
    expect(evaluateTxEmployerRow({ ...TX_DENTIST, policy_expiration_date: '2025-08-01T00:00:00.000' }, NOW)).toMatchObject({ keep: false, reason: 'policy expired' });
    expect(evaluateTxEmployerRow({ ...TX_DENTIST, insured_employer_name: 'LONE STAR STAFFING LLC' }, NOW)).toMatchObject({ keep: false, reason: 'staffing agency, PEO or payroll company' });
    expect(evaluateTxEmployerRow({ ...TX_DENTIST, insured_employer_name: 'METHODIST HOSPITAL' }, NOW)).toMatchObject({ keep: false, reason: 'hospital, institution or government employer' });
    expect(evaluateTxEmployerRow({ ...TX_DENTIST, insured_employer_name: 'ASPEN DENTAL MANAGEMENT INC' }, NOW)).toMatchObject({ keep: false, reason: 'national chain or franchise name' });
    expect(parseTxDate(null)).toBeNull();
    expect(parseTxDate('2027-08-01T00:00:00.000')?.getUTCFullYear()).toBe(2027);
  });

  it('covers exactly the six intended verticals and rotates homeservices across its three NAICS classes', () => {
    expect(Object.keys(TX_NAICS).sort()).toEqual(['dental', 'homecare', 'homeservices', 'insurance', 'septic', 'towing']);
    expect(txSupportsVertical('bailbonds')).toBe(false);
    expect(txSupportsVertical('freight')).toBe(false);
    expect([0, 1, 2, 3].map((d) => txClassForDay('homeservices', d)?.code)).toEqual(['238220', '238210', '238160', '238220']);
    expect(txClassForDay('dental', 7)?.code).toBe('621210');
    expect(txClassForDay('bailbonds', 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('registry source rotation', () => {
  it('gives every homeservices source a slot, with Virginia twice in five', () => {
    const slots = [0, 1, 2, 3, 4].map(homeservicesSourceForSlot);
    expect(slots).toEqual(['wa', 'nyc', 'va', 'ar', 'va']);
    expect(new Set(slots)).toEqual(new Set(['wa', 'nyc', 'va', 'ar']));
    expect(homeservicesSourceForSlot(-1)).toBe('va');
  });

  it('gives California two homecare slots in five and leaves batch 1 the rest', () => {
    expect([0, 1, 2, 3, 4].map(homecareSourceForSlot)).toEqual(['batch1', 'ca', 'batch1', 'ca', 'batch1']);
  });

  it('gives Texas one slot in six', () => {
    expect([0, 1, 2, 3, 4, 5].map(useTxForSlot)).toEqual([false, false, false, false, false, true]);
    expect(useTxForSlot(-1)).toBe(true);
  });

  it('fetches only the slot it selected, and caps that source at max', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await findHomeservicesCandidates(5, { source: 'nyc', now: NOW });
    expect(res.candidates.length).toBeLessThanOrEqual(5);
    // count(*) returned no rows -> the source reports an error, it does not throw.
    expect(res.errors.join(' ')).toMatch(/homeservices nyc/);
  });

  it('keeps the new sources\' wording reachable from the draft prompt', () => {
    expect([homeservices.id, homecare.id, dental.id]).toEqual(['homeservices', 'homecare', 'dental']);
    // registryFact is only visible through the draft prompt it is spliced into.
    expect(homeservices.systemPrompt).toContain('Virginia Department of Professional and Occupational Regulation contractor licence file');
    expect(homecare.systemPrompt).toContain('California Department of Public Health licensed facility file');
    // The drafter must still be told to copy the lead's own words, not to
    // paraphrase a source into "a registry" when it is not one.
    for (const p of [homeservices, homecare, dental]) {
      expect(p.systemPrompt).toContain('worded exactly as the lead data words it');
    }
  });
});
