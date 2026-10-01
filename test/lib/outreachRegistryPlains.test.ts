import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toIaInsuranceRow, evaluateIaInsuranceRow, toIaInsuranceLead, iaInsuranceId, parseIaDate,
  parseIaInsuranceCsv, readFirstCsvFromZip, allIaInsuranceLeads, selectIaLeads, iaMailboxIsRole, IA_INS_COL,
} from '@/lib/outreach/discovery/insuranceIowa';
import {
  evaluateNeRow, toNeLead, neTypeLabel, splitOwnedBy, flipLastFirst,
  parseOkListPage, parseOkCityLine, evaluateOkListRow, evaluateOkRow, toOkLead, fetchOkDetail, allOkChildcareLeads, allNebraskaChildcareLeads,
  type NeChildcareRow, type OkListRow, type OkDetail,
} from '@/lib/outreach/discovery/childcarePlains';
import { emptyResult } from '@/lib/outreach/discovery/registryCommon';
import { allMoLodgingLeads, evaluateMoLodgingRow, toMoLodgingLead, moLodgingId, type MoLodgingRow } from '@/lib/outreach/discovery/lodgingMissouri';

const NOW = new Date('2026-09-30T12:00:00Z');
const keep = <T>(ev: { keep: boolean } | T) => {
  expect((ev as { keep: boolean }).keep, JSON.stringify(ev)).toBe(true);
  return ev as T & { keep: true; adjust: number; reasons: string[] };
};
const reject = (ev: { keep: boolean; reason?: string }) => {
  expect(ev.keep, JSON.stringify(ev)).toBe(false);
  return ev.reason as string;
};

afterEach(() => { vi.unstubAllGlobals(); });

// A stored (method 0) single-member zip, built by hand so the test needs no zip library.
function storedZip(name: string, content: string): Buffer {
  const data = Buffer.from(content, 'utf8');
  const nameBuf = Buffer.from(name, 'latin1');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 8);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0, 10);
  cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(0, 42);
  const cdFull = Buffer.concat([cd, nameBuf]);
  const localFull = Buffer.concat([local, nameBuf, data]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdFull.length, 12); eocd.writeUInt32LE(localFull.length, 16);
  return Buffer.concat([localFull, cdFull, eocd]);
}

// ---------------------------------------------------------------------------
describe('Iowa insurance producer entities', () => {
  const HEADER = 'entity_name,email,address_line_1,address_line_2,city,state,zip_code,business_phone,expiry_date,entity_latitude,entity_longitude,entity_location';
  const row = (o: Partial<Record<string, string>>) => toIaInsuranceRow({
    [IA_INS_COL.name]: 'PIERCE INSURANCE AGENCY LLC', [IA_INS_COL.email]: 'jp@pierceagency.com', [IA_INS_COL.city]: 'AINSWORTH',
    [IA_INS_COL.state]: 'NE', [IA_INS_COL.zip]: '69210', [IA_INS_COL.phone]: '4023872883', [IA_INS_COL.expiry]: '2027-11-30 00:00:00 UTC', ...o,
  });

  it('keeps a non-resident independent agency with business email and phone', () => {
    const r = row({});
    const ev = keep(evaluateIaInsuranceRow(r, NOW));
    expect(ev.adjust).toBe(3); // +5 business email, -2 non-resident
    const lead = toIaInsuranceLead(r, ev);
    expect(lead.sourceKey).toBe('insurance:ia:pierce-insurance-agency-llc-69210');
    expect(lead.email).toBe('jp@pierceagency.com');
    expect(lead.phone).toBe('(402) 387-2883');
    expect(lead.state).toBe('NE');
    expect(lead.location).toBe('Ainsworth, NE');
    expect(lead.contactSourceUrl).toContain('data.iowa.gov');
    expect(lead.description).toContain('Iowa Insurance Division licensee file');
    expect(lead.description).not.toMatch(/[^\x20-\x7e]/);
  });

  it('prefers the DBA trade name and keeps the legal name', () => {
    const lead = toIaInsuranceLead(row({ [IA_INS_COL.name]: 'JRC PIERCE LLC DBA MUNDHENKE AGENCY' }), { adjust: 0, reasons: [] });
    expect(lead.name).toBe('Mundhenke Agency');
    expect(lead.legalName).toBe('Jrc Pierce LLC');
  });

  it('scores a free-mail contact down but keeps it', () => {
    const ev = keep(evaluateIaInsuranceRow(row({ [IA_INS_COL.email]: 'janakay05@gmail.com', [IA_INS_COL.state]: 'IA' }), NOW));
    expect(ev.adjust).toBe(-5);
  });

  it('rejects Florida (covered by FL DFS), expired licences and no-contact rows', () => {
    expect(reject(evaluateIaInsuranceRow(row({ [IA_INS_COL.state]: 'FL' }), NOW))).toMatch(/Florida/);
    expect(reject(evaluateIaInsuranceRow(row({ [IA_INS_COL.expiry]: '2026-06-01 00:00:00 UTC' }), NOW))).toMatch(/expired/);
    expect(reject(evaluateIaInsuranceRow(row({ [IA_INS_COL.email]: '', [IA_INS_COL.phone]: '' }), NOW))).toMatch(/no contact/);
  });

  it('rejects captive agents by email domain and national brokers / non-agencies by name', () => {
    expect(reject(evaluateIaInsuranceRow(row({ [IA_INS_COL.name]: 'JOHN DOE AGENCY INC', [IA_INS_COL.email]: 'jdoe@amfam.com' }), NOW))).toMatch(/domain/);
    expect(reject(evaluateIaInsuranceRow(row({ [IA_INS_COL.name]: 'ACRISURE OF NEBRASKA LLC', [IA_INS_COL.email]: 'x@example.com' }), NOW))).toMatch(/large brokerage/);
    expect(reject(evaluateIaInsuranceRow(row({ [IA_INS_COL.name]: 'SCHMIDT FAMILY FUNERAL HOME' }), NOW))).toMatch(/non-agency/);
    expect(reject(evaluateIaInsuranceRow(row({ [IA_INS_COL.name]: 'FIRST STATE BANK INSURANCE' }), NOW))).toMatch(/non-agency/);
  });

  it('parses the Iowa date format and builds a stable id', () => {
    expect(parseIaDate('2027-08-31 00:00:00 UTC')?.toISOString()).toBe('2027-08-31T00:00:00.000Z');
    expect(parseIaDate('')).toBeNull();
    expect(iaInsuranceId({ name: 'J. Rasmussen & Associates, LLC', zip: '68620-1234' })).toBe('j-rasmussen-and-associates-llc-68620');
  });

  it('reads the CSV out of the zip the endpoint serves, quoted fields included', async () => {
    const csv = `${HEADER}\n"SMITH, JONES & CO INSURANCE LLC",a@smithjones.com,1 MAIN,,OMAHA,NE,68102,4025551212,2028-01-31 00:00:00 UTC,41.2,-95.9,POINT(1 2)\nBETA AGENCY,b@beta.com,2 ELM,,DES MOINES,IA,50309,5155551212,2028-01-31 00:00:00 UTC,41.6,-93.6,POINT(1 2)\n`;
    const text = await readFirstCsvFromZip(storedZip('insurance_entities_668_rows.csv', csv));
    const rows = parseIaInsuranceCsv(text);
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('SMITH, JONES & CO INSURANCE LLC');
    expect(rows[1].state).toBe('IA');
  });

  it('refuses a body whose header is missing', () => {
    expect(() => parseIaInsuranceCsv('a,b\n1,2\n')).toThrow(/header not found/);
  });

  it('allIaInsuranceLeads fetches the zip, dedupes name+zip, honours the states filter, and rejects short bodies', async () => {
    const lines = [HEADER];
    for (let i = 0; i < 600; i++) lines.push(`AGENCY ${i} INS LLC,a${i}@agency${i}.com,1 MAIN,,TOWN,${i % 2 ? 'NE' : 'MO'},${60000 + i},402555${String(1000 + i).slice(-4)},2028-01-31 00:00:00 UTC,0,0,P`);
    lines.push('AGENCY 1 INS LLC,dup@agency1.com,1 MAIN,,TOWN,NE,60001,4025551001,2028-01-31 00:00:00 UTC,0,0,P');
    lines.push('FL AGENCY LLC,f@flagency.com,1 MAIN,,MIAMI,FL,33101,3055551212,2028-01-31 00:00:00 UTC,0,0,P');
    const zip = storedZip('x.csv', lines.join('\n'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(zip), { status: 200 })));
    const all = await allIaInsuranceLeads({ now: NOW, minRows: 500 });
    expect(all.errors).toEqual([]);
    expect(all.scanned).toBe(602);
    expect(all.candidates).toHaveLength(600);
    expect(all.rejected['duplicate name and zip in the file']).toBe(1);
    expect(all.rejected['Florida agency (covered by the FL DFS source)']).toBe(1);
    const ne = await allIaInsuranceLeads({ now: NOW, minRows: 500, states: ['ne'] });
    expect(ne.candidates.every((l) => l.state === 'NE')).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(storedZip('x.csv', `${HEADER}\nA,a@a.com,1,,T,NE,68000,4025551212,2028-01-31 00:00:00 UTC,0,0,P\n`)), { status: 200 })));
    const short = await allIaInsuranceLeads({ now: NOW, minRows: 500 });
    expect(short.candidates).toHaveLength(0);
    expect(short.errors[0]).toMatch(/refusing a truncated/);
  });
});

// ---------------------------------------------------------------------------
describe('Nebraska DHHS child care roster', () => {
  const ne = (o: Partial<NeChildcareRow>): NeChildcareRow => ({
    Full_Name: 'BABY BUG\'S DAYCARE CLUB owned by NIKOLE BENEDICT', License_Type: 'Family Child Care Home I', License_Number: 'FI11670',
    City: 'ARLINGTON', State: 'NE', County: 'Washington', Capacity: 'Capacity: 10', Phone: '(402) 317-0121', Owner_Manager: 'BENEDICT, NIKOLE',
    Roster_Date: '2025-10-15', GIS_Status: 'on current roster', ...o,
  });

  it('splits "owned by" and flips "LAST, FIRST"', () => {
    expect(splitOwnedBy("BARB'S DAYCARE own by BARB FERDEN")).toEqual({ trade: "BARB'S DAYCARE", owner: 'BARB FERDEN' });
    expect(splitOwnedBy('RENNING\'S RUGRATS OB CHELSEA RENNING').owner).toBe('CHELSEA RENNING');
    expect(splitOwnedBy('PLAIN CENTER').owner).toBeNull();
    expect(flipLastFirst('DILWOOD, SHARON')).toEqual({ name: 'SHARON DILWOOD', flipped: true });
    expect(flipLastFirst('LITTLE SUNSHINE IN-HOME CHILDCARE').flipped).toBe(false);
  });

  it('keeps a home provider as a phone-only lead with the trade name displayed', () => {
    const r = ne({});
    const ev = keep(evaluateNeRow(r, NOW));
    const lead = toNeLead(r, ev);
    expect(lead.sourceKey).toBe('childcare:ne:FI11670');
    expect(lead.name).toBe("Baby Bug's Daycare Club");
    expect(lead.legalName).toBe('Nikole Benedict');
    expect(lead.phone).toBe('(402) 317-0121');
    expect(lead.email).toBeNull();
    expect(lead.state).toBe('NE');
    expect(lead.typeLabel).toBe('licensed family child care home');
    expect(ev.reasons.join(' ')).toContain('very small licensed capacity');
  });

  it('writes a sole proprietor licensed in her own name as First Last', () => {
    const lead = toNeLead(ne({ Full_Name: 'DILWOOD, SHARON' }), { adjust: 0, reasons: [] });
    expect(lead.name).toBe('Sharon Dilwood');
    expect(lead.legalName).toBeNull();
  });

  it('handles provisional and school-age licence types', () => {
    expect(neTypeLabel('Provisional Family Child Care Home II')).toBe('licensed family child care home');
    expect(neTypeLabel('Provisional School-Age-Only Center')).toBe('licensed school-age child care center');
    expect(neTypeLabel('Child Care Center')).toBe('licensed child care center');
    expect(neTypeLabel('Something Else')).toBeNull();
  });

  it('rejects chains, no-phone rows, institutional rows score down, and a stale roster', () => {
    expect(reject(evaluateNeRow(ne({ Full_Name: 'PRIMROSE SCHOOL AT WEST MAPLE owned by ELP2, LLC' }), NOW))).toMatch(/chain/);
    expect(reject(evaluateNeRow(ne({ Phone: null }), NOW))).toMatch(/no usable phone/);
    expect(reject(evaluateNeRow(ne({ License_Type: 'Residential' }), NOW))).toMatch(/not in scope/);
    expect(reject(evaluateNeRow(ne({}), new Date('2028-01-01T00:00:00Z')))).toMatch(/too old/);
    const inst = keep(evaluateNeRow(ne({ Full_Name: 'MPS - NORRIS ELEMENTARY owned by MILLARD PUBLIC SCHOOLS FOUNDATION INC', Capacity: 'Capacity: 99' }), NOW));
    expect(inst.reasons.join(' ')).toContain('institutional');
  });
});

// ---------------------------------------------------------------------------
describe('Oklahoma child care locator', () => {
  const listRow = (o: Partial<OkListRow> = {}): OkListRow => ({
    vendorId: 'K820051723', name: 'ADAMS, AMANDA', officialDoingBusinessAs: '', facilityType: 'childcare-home',
    addressLines: ['415 S ROSE AVE', 'GLENCOE, OK 74032'], ...o,
  });
  const detail = (o: Partial<OkDetail> = {}): OkDetail => ({
    phoneNumber: '(580) 383-8492', emailAddress: 'AmandaAdams2@yahoo.com', directorFullName: 'Amanda  Adams', licenseCapacity: 8, starLevelCode: '2', ...o,
  });

  it('extracts the statewide list and buildId from the page data', () => {
    const page = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ buildId: 'abc123', props: { pageProps: { childcareProviders: [listRow()] } } })}</script></html>`;
    const p = parseOkListPage(page);
    expect(p.buildId).toBe('abc123');
    expect(p.providers).toHaveLength(1);
    expect(() => parseOkListPage('<html></html>')).toThrow(/__NEXT_DATA__/);
  });

  it('parses the city line', () => {
    expect(parseOkCityLine(['2501 E ARCHER ST', 'TULSA, OK 74110'])).toEqual({ city: 'TULSA', state: 'OK' });
    expect(parseOkCityLine(undefined)).toEqual({ city: null, state: 'OK' });
  });

  it('builds a lead with email and phone, free-mail kept and scored down', () => {
    const ev = keep(evaluateOkRow(listRow(), detail()));
    expect(ev.reasons.join(' ')).toContain('free-mail');
    const lead = toOkLead(listRow(), detail(), ev);
    expect(lead.sourceKey).toBe('childcare:ok:K820051723');
    expect(lead.name).toBe('Amanda Adams');
    expect(lead.email).toBe('amandaadams2@yahoo.com');
    expect(lead.phone).toBe('(580) 383-8492');
    expect(lead.location).toBe('Glencoe, OK');
    expect(lead.contactName).toBe('Amanda Adams');
    expect(lead.contactSourceUrl).toBe('https://ccl.dhs.ok.gov/providers/K820051723');
    expect(lead.signalDetail).not.toMatch(/complaint|monitor/i);
  });

  it('uses the DBA as the display name when one is registered', () => {
    const r = listRow({ officialDoingBusinessAs: 'Dulce Comienzo Home Daycare  LLC', name: 'ROMAN, ALEXANDRA' });
    const lead = toOkLead(r, detail(), { adjust: 0, reasons: [] });
    expect(lead.name).toBe('Dulce Comienzo Home Daycare LLC'.replace(/\s+/g, ' ').replace('Llc', 'LLC'));
    expect(lead.legalName).toBe('Alexandra Roman');
  });

  it('screens by list row before any detail request, and by detail afterwards', () => {
    expect(evaluateOkListRow(listRow({ facilityType: 'residential' }))).toEqual({ keep: false, reason: 'facility type not in scope' });
    expect(evaluateOkListRow(listRow({ name: 'KINDERCARE LEARNING CENTER', facilityType: 'childcare-center' }))).toMatchObject({ keep: false });
    expect(reject(evaluateOkRow(listRow(), detail({ phoneNumber: '', emailAddress: '' })))).toMatch(/no contact/);
    expect(reject(evaluateOkRow(listRow(), detail({ revocationSent: 'True' })))).toMatch(/revocation/);
    expect(keep(evaluateOkRow(listRow(), detail({ emailAddress: '' })))).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('Missouri lodging list', () => {
  const lod = (o: Partial<MoLodgingRow> = {}): MoLodgingRow => ({
    establishment_name: 'EAGLE\'S LANDING MOTEL', establishment_address: '1 RIVER RD', establishment_city: 'BRANSON', establishment_state: 'MO',
    establishment_zip: '65616', county: 'TANEY', telephone: '(417)338-2524', facility_status: 'Active', ...o,
  });

  it('keeps an independent active motel as a phone-first lead', () => {
    const ev = keep(evaluateMoLodgingRow(lod()));
    expect(ev.adjust).toBe(-7);
    const lead = toMoLodgingLead(lod(), ev);
    expect(lead.sourceKey).toBe('lodging:mo:eagle-s-landing-motel-65616');
    expect(lead.phone).toBe('(417) 338-2524');
    expect(lead.email).toBeNull();
    expect(lead.location).toBe('Branson, MO');
    expect(lead.description).toContain('Missouri Department of Health and Senior Services lodging list');
    expect(moLodgingId({ establishment_name: 'A & B Inn', establishment_zip: '65616-1234' })).toBe('a-and-b-inn-65616');
  });

  it('rejects chains, non-active rows and rows without a phone', () => {
    expect(reject(evaluateMoLodgingRow(lod({ establishment_name: 'HAMPTON INN & SUITES KANSAS CITY' })))).toMatch(/chain/);
    expect(reject(evaluateMoLodgingRow(lod({ establishment_name: 'AC HOTEL AT CENTRAL WEST END' })))).toMatch(/chain/);
    expect(reject(evaluateMoLodgingRow(lod({ facility_status: 'Closed' })))).toMatch(/not Active/);
    expect(reject(evaluateMoLodgingRow(lod({ facility_status: 'Pending' })))).toMatch(/not Active/);
    expect(reject(evaluateMoLodgingRow(lod({ telephone: '' })))).toMatch(/no usable phone/);
  });
});

// ---------------------------------------------------------------------------
// Review additions: caller-phone policy, Iowa back-office/roll-up filtering and determinism, partial-data guards.
describe('Iowa insurance review fixes', () => {
  const base = (o: Partial<Record<string, string>>) => toIaInsuranceRow({
    [IA_INS_COL.name]: 'PIERCE INSURANCE AGENCY LLC', [IA_INS_COL.email]: 'jp@pierceagency.com', [IA_INS_COL.city]: 'AINSWORTH',
    [IA_INS_COL.state]: 'NE', [IA_INS_COL.zip]: '69210', [IA_INS_COL.phone]: '4023872883', [IA_INS_COL.expiry]: '2027-11-30 00:00:00 UTC', ...o,
  });
  const run = (rows: ReturnType<typeof base>[]) => { const res = emptyResult(); selectIaLeads(rows, { now: NOW }, res); return res; };

  it('pads New England zips so the key carries a real 5-digit zip', () => {
    expect(iaInsuranceId({ name: 'RISCO INSURANCE BROKERAGE, INC.', zip: '2914' })).toBe('risco-insurance-brokerage-inc-02914');
    expect(iaInsuranceId({ name: 'X', zip: '50613-1234' })).toBe('x-50613');
  });

  it('rejects licensing/compliance mailboxes but not an agent who merely has "license" in a longer name', () => {
    for (const e of ['licensing@crcgroup.com', 'LICENSING@USI.COM', 'agencylicense@alliant.com', 'idi_licensing@protective.com', 'compliance@x.com', 'cert@libertyunitedinsurance.com', 'tfglicensing@tfggroup.com']) {
      expect(iaMailboxIsRole(e), e).toBe(true);
      reject(evaluateIaInsuranceRow(base({ [IA_INS_COL.email]: e }), NOW));
    }
    for (const e of ['jp@pierceagency.com', 'info@mcgillbrokerage.com', 'david.laubins@gmail.com']) expect(iaMailboxIsRole(e), e).toBe(false);
  });

  it('catches farmersagency.com captives and keeps similarly named independents', () => {
    expect(reject(evaluateIaInsuranceRow(base({ [IA_INS_COL.email]: 'thomas.lmason@farmersagency.com' }), NOW))).toMatch(/captive|roll-up/);
    keep(evaluateIaInsuranceRow(base({ [IA_INS_COL.name]: 'FARMERS UNION AGCY INC', [IA_INS_COL.email]: 'robin@fuainsurance.com' }), NOW));
    keep(evaluateIaInsuranceRow(base({ [IA_INS_COL.name]: 'USHER INSURANCE AGENCY', [IA_INS_COL.email]: 'u@usherins.com' }), NOW));
  });

  it('drops a business domain shared by 3+ entities (roll-up) but keeps shared regional ISP and free-mail addresses', () => {
    const roll = ['A', 'B', 'C'].map((n, i) => base({ [IA_INS_COL.name]: `ENTITY ${n} LLC`, [IA_INS_COL.email]: `p${i}@bigbroker.com`, [IA_INS_COL.zip]: `6000${i}` }));
    const isp = ['A', 'B', 'C'].map((n, i) => base({ [IA_INS_COL.name]: `ISP ${n} AGENCY`, [IA_INS_COL.email]: `q${i}@netins.net`, [IA_INS_COL.zip]: `6100${i}` }));
    const res = run([...roll, ...isp]);
    expect(res.candidates.map((c) => c.name).sort()).toEqual(['Isp A Agency', 'Isp B Agency', 'Isp C Agency']);
    expect(Object.keys(res.rejected).join()).toMatch(/shared by 3\+/);
  });

  it('collapses the same email on two entities to one lead', () => {
    const res = run([base({ [IA_INS_COL.name]: 'ALPHA AGENCY LLC', [IA_INS_COL.zip]: '69211' }), base({ [IA_INS_COL.name]: 'ZULU AGENCY LLC', [IA_INS_COL.zip]: '69212' })]);
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0].name).toBe('Alpha Agency LLC');
  });

  it('picks the same row for a repeated name+zip whatever the file order (key and email stable across weekly refreshes)', () => {
    const a = base({ [IA_INS_COL.email]: 'zed@gmail.com' });
    const b = base({ [IA_INS_COL.email]: 'jp@pierceagency.com' });
    const c = base({ [IA_INS_COL.email]: 'JP@PIERCEAGENCY.COM' });
    const r1 = run([a, b, c]);
    const r2 = run([c, a, b]);
    expect(r1.candidates).toHaveLength(1);
    expect(r1.candidates[0].email).toBe('jp@pierceagency.com');
    expect(r2.candidates[0].email).toBe(r1.candidates[0].email);
  });

  it('excludes a person-named entity (or a person behind a DBA) from callers, not a business or a person-named agency LLC', () => {
    const lead = (name: string) => toIaInsuranceLead(base({ [IA_INS_COL.name]: name }), { adjust: 0, reasons: [] });
    expect(lead('BRENT LEAVITT').callerPhoneExcluded).toBe('person-named business');
    expect(lead('JOHN Q SMITH DBA SMITH INSURANCE').callerPhoneExcluded).toBe('person-named business');
    for (const n of ['MERRITT FINANCIAL', 'HIP POCKET HAESSLER INS LLC', 'BENEFIT ADVOCATES', 'PIERCE INSURANCE AGENCY LLC', 'MEDICARE MENTORS', 'MIDWEST INDEPENDENT BANKERSBANK']) {
      expect(lead(n).callerPhoneExcluded, n).toBeFalsy();
    }
    expect(lead('BRENT LEAVITT').email).toBe('jp@pierceagency.com'); // facts and email are kept
  });

  it('refuses a download cut short by its own Content-Length', async () => {
    const lines = ['entity_name,email,city,state,zip_code,business_phone,expiry_date'];
    for (let i = 0; i < 600; i++) lines.push(`AGENCY ${i} INS LLC,a${i}@agency${i}.com,TOWN,NE,${60000 + i},4025551000,2028-01-31 00:00:00 UTC`);
    const csv = Buffer.from(lines.join('\n'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(csv.subarray(0, 1000)), { status: 200, headers: { 'content-length': String(csv.length) } })));
    const r = await allIaInsuranceLeads({ now: NOW, minRows: 5 });
    expect(r.candidates).toHaveLength(0);
    expect(r.errors[0]).toMatch(/cut short/);
  });
});

describe('Nebraska / Oklahoma caller-phone policy and partial-data guards', () => {
  const ne = (o: Partial<NeChildcareRow>): NeChildcareRow => ({
    Full_Name: 'HUG-A-BUNCH CHILD CARE CENTER, LLC', License_Type: 'Child Care Center', License_Number: 'CC100', City: 'OMAHA', State: 'NE', County: 'Douglas',
    Capacity: 'Capacity: 60', Phone: '(402) 328-0040', Owner_Manager: 'SMITH, JANE', Roster_Date: '2025-10-15', GIS_Status: 'on current roster', ...o,
  });
  const exc = (o: Partial<NeChildcareRow>) => toNeLead(ne(o), { adjust: 0, reasons: [] }).callerPhoneExcluded;

  it('NE: home types and "LAST, FIRST" licensees are excluded; centres are not; facts and phone data stay on the lead', () => {
    expect(exc({})).toBeFalsy();
    expect(exc({ Full_Name: 'LITTLE LEARNERS ACADEMY owned by LL LLC', License_Type: 'Preschool' })).toBeFalsy();
    expect(exc({ License_Type: 'Family Child Care Home I', Full_Name: "CONNIE'S DAYCARE II" })).toBe('home-based provider');
    expect(exc({ License_Type: 'Provisional Family Child Care Home II', Full_Name: 'BABY LEO DAYCARE LLC' })).toBe('home-based provider');
    expect(exc({ Full_Name: 'MEISINGER, AMANDA' })).toBe('sole proprietor');
    const lead = toNeLead(ne({ Full_Name: 'MEISINGER, AMANDA', License_Type: 'Family Child Care Home I' }), { adjust: 0, reasons: [] });
    expect(lead.licenseId).toBe('CC100');
    expect(lead.name).toBe('Amanda Meisinger');
  });

  it('NE: a roster past the age limit is an error, not a silent zero', async () => {
    const feats = Array.from({ length: 600 }, (_, i) => ({ attributes: ne({ License_Number: `CC${i}` }) }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ features: feats }), { status: 200 })));
    const fresh = await allNebraskaChildcareLeads({ now: NOW });
    expect(fresh.errors).toEqual([]);
    expect(fresh.candidates.length).toBe(600);
    const stale = await allNebraskaChildcareLeads({ now: new Date('2027-06-01T00:00:00Z') });
    expect(stale.candidates).toHaveLength(0);
    expect(stale.errors[0]).toMatch(/stale/);
  });

  const okList = (o: Partial<OkListRow> = {}): OkListRow => ({ vendorId: 'K1', name: 'ADAMS, AMANDA', officialDoingBusinessAs: '', facilityType: 'childcare-home', addressLines: ['1 MAIN', 'GLENCOE, OK 74032'], ...o });
  const okDet: OkDetail = { phoneNumber: '(580) 383-8492', emailAddress: 'a@yahoo.com', directorFullName: 'A', licenseCapacity: 8 };

  it('OK: homes, person-named providers and DBA-over-person are excluded; centres with a business name are not', () => {
    const x = (r: OkListRow) => toOkLead(r, okDet, { adjust: 0, reasons: [] }).callerPhoneExcluded;
    expect(x(okList())).toBe('sole proprietor');
    expect(x(okList({ name: 'KIDS CORNER LLC', facilityType: 'childcare-home' }))).toBe('home-based provider');
    expect(x(okList({ name: 'HAPPY HANDS LEARNING CENTER LLC', facilityType: 'childcare-center' }))).toBeFalsy();
    expect(x(okList({ name: 'BIG FIVE GUYMON HEAD START', facilityType: 'childcare-center' }))).toBeFalsy();
    expect(x(okList({ name: 'ROMAN, ALEXANDRA', officialDoingBusinessAs: 'Dulce Comienzo Child Care', facilityType: 'childcare-center' }))).toBe('sole proprietor');
    expect(toOkLead(okList(), okDet, { adjust: 0, reasons: [] }).email).toBe('a@yahoo.com');
  });

  it('OK: a persistent 404 triggers a buildId refresh and then succeeds on the new id', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/providers')) return new Response(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ buildId: 'NEW', props: { pageProps: { childcareProviders: [okList()] } } })}</script>`, { status: 200 });
      seen.push(url);
      return url.includes('/OLD/') ? new Response('nf', { status: 404 }) : new Response(JSON.stringify({ pageProps: okDet }), { status: 200 });
    }));
    const session = { buildId: 'OLD', refreshes: 0 };
    const d = await fetchOkDetail(session, 'K1', 1);
    expect(d?.phoneNumber).toBe('(580) 383-8492');
    expect(session.buildId).toBe('NEW');
    expect(seen.filter((u) => u.includes('/OLD/')).length).toBe(2);
  });

  it('OK: a dead detail endpoint stops the pull with an error instead of grinding through every provider', async () => {
    const providers = Array.from({ length: 600 }, (_, i) => okList({ vendorId: `K${i}` }));
    const calls = { detail: 0 };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/providers')) return new Response(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ buildId: 'B', props: { pageProps: { childcareProviders: providers } } })}</script>`, { status: 200 });
      calls.detail++;
      return new Response('nf', { status: 404 });
    }));
    const r = await allOkChildcareLeads({ delayMs: 0, retryMs: 0 });
    expect(r.candidates).toHaveLength(0);
    expect(r.errors[0]).toMatch(/in a row returned nothing usable/);
    expect(calls.detail).toBeLessThan(15 * 3 + 5);
  });

  it('OK: a high share of empty details flags the result as partial', async () => {
    const providers = Array.from({ length: 600 }, (_, i) => okList({ vendorId: `K${i}` }));
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/providers')) return new Response(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ buildId: 'B', props: { pageProps: { childcareProviders: providers } } })}</script>`, { status: 200 });
      n++;
      return new Response(JSON.stringify({ pageProps: n % 3 === 0 ? {} : okDet }), { status: 200 }); // every 3rd empty
    }));
    const r = await allOkChildcareLeads({ max: 60, delayMs: 0, retryMs: 0 });
    expect(r.candidates.length).toBe(40);
    expect(r.errors.join()).toMatch(/PARTIAL/);
  });
});

describe('Missouri lodging review fixes', () => {
  const lod = (o: Partial<MoLodgingRow> = {}): MoLodgingRow => ({
    establishment_name: 'SUNSET MOTEL', establishment_city: 'BRANSON', establishment_state: 'MO', establishment_zip: '65616', county: 'TANEY', telephone: '(417)338-2524', facility_status: 'Active', ...o,
  });
  const exc = (name: string) => toMoLodgingLead(lod({ establishment_name: name }), { adjust: 0, reasons: [] }).callerPhoneExcluded;

  it('does not read two-word motel/inn/resort names as a person', () => {
    for (const n of ['SUNSET MOTEL', 'LAKESIDE RESORT', 'BUDGET INN', 'CABINS AT TABLE ROCK', 'THE LANDING', "FISHERMAN'S HAVEN", 'KOZY KAMP', 'CAMDEN ON THE LAKE', 'WAGON WHEEL MOTEL', 'BRANSON EXPRESS INN']) {
      expect(exc(n), n).toBeFalsy();
    }
    expect(exc('JOHN SMITH')).toBe('person-named business');
  });

  it('rejects franchise brands the first cut missed', () => {
    for (const n of ['SPRING HILL SUITES', 'TOWNPLACE SUITES ST LOUIS WEST-WENTZVILLE', 'TRU SPRINGFIELD', 'VIB SPRINGFIELD', 'PEAR TREE INN CAPE GIRARDEAU WEST', 'ELEMENT HOTEL BRANSON', 'ISLE OF CAPRI CASINO', 'RED LION INN AND SUITES', 'AMERICAS VALUE INN']) {
      expect(reject(evaluateMoLodgingRow(lod({ establishment_name: n }))), n).toMatch(/chain/);
    }
    keep(evaluateMoLodgingRow(lod({ establishment_name: 'BRANSON EXPRESS INN' })));
  });

  it('refuses a response that hit the row limit', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => lod({ establishment_name: `MOTEL ${i}`, establishment_zip: String(60000 + (i % 9999)) }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })));
    const r = await allMoLodgingLeads({});
    expect(r.candidates).toHaveLength(0);
    expect(r.errors[0]).toMatch(/5000-row/);
  });
});
