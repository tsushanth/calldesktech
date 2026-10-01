import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toIaInsuranceRow, evaluateIaInsuranceRow, toIaInsuranceLead, iaInsuranceId, parseIaDate,
  parseIaInsuranceCsv, readFirstCsvFromZip, allIaInsuranceLeads, IA_INS_COL,
} from '@/lib/outreach/discovery/insuranceIowa';
import {
  evaluateNeRow, toNeLead, neTypeLabel, splitOwnedBy, flipLastFirst,
  parseOkListPage, parseOkCityLine, evaluateOkListRow, evaluateOkRow, toOkLead,
  type NeChildcareRow, type OkListRow, type OkDetail,
} from '@/lib/outreach/discovery/childcarePlains';
import { evaluateMoLodgingRow, toMoLodgingLead, moLodgingId, type MoLodgingRow } from '@/lib/outreach/discovery/lodgingMissouri';

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
    const all = await allIaInsuranceLeads({ now: NOW });
    expect(all.errors).toEqual([]);
    expect(all.scanned).toBe(602);
    expect(all.candidates).toHaveLength(600);
    expect(all.rejected['duplicate name and zip in the file']).toBe(1);
    expect(all.rejected['Florida agency (covered by the FL DFS source)']).toBe(1);
    const ne = await allIaInsuranceLeads({ now: NOW, states: ['ne'] });
    expect(ne.candidates.every((l) => l.state === 'NE')).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(storedZip('x.csv', `${HEADER}\nA,a@a.com,1,,T,NE,68000,4025551212,2028-01-31 00:00:00 UTC,0,0,P\n`)), { status: 200 })));
    const short = await allIaInsuranceLeads({ now: NOW });
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
