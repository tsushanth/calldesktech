import { describe, it, expect, vi, afterEach } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import {
  toAlGenConRow, evaluateAlGenConRow, toAlGenConLead, parseAlDate, streamAlGenConLeads, AL_COL,
} from '@/lib/outreach/discovery/alGenContractors';
import {
  evaluateKyChildcareRow, toKyChildcareLead, kyCityFromAddress, allKyChildcareLeads, type KyChildcareRow,
} from '@/lib/outreach/discovery/kyChildcare';
import {
  parseSharedStrings, parseSheetRows, colIndex, readXlsxFirstSheet, parseNcHomecareSheet, evaluateNcHomecareRow,
  toNcHomecareLead, parseNcDate, findHclistLink, allNcHomecareLeads,
} from '@/lib/outreach/discovery/ncDhsrHomecare';

const NOW = new Date('2026-09-30T12:00:00Z');
afterEach(() => { vi.unstubAllGlobals(); });

// ---------------------------------------------------------------------------
describe('Alabama general contractors roster', () => {
  const row = (o: Partial<Record<string, string>>) => toAlGenConRow({
    [AL_COL.name]: 'FLANAGAN PLUMBING LLC', [AL_COL.license]: 'S-53030', [AL_COL.city]: 'OZARK', [AL_COL.state]: 'AL',
    [AL_COL.phone]: '(334) 237-9279', [AL_COL.specialty]: 'SUBCONTRACTOR:  PLUMBING', [AL_COL.expiration]: '5/31/2027', ...o,
  } as Record<string, string>);

  it('parses the M/D/YYYY expiry', () => {
    expect(parseAlDate('5/31/2027')?.toISOString()).toBe('2027-05-31T00:00:00.000Z');
    expect(parseAlDate('')).toBeNull();
  });

  it('keeps an active plumbing sub with a phone and builds a homeservices:al lead', () => {
    const r = row({});
    const ev = evaluateAlGenConRow(r, NOW);
    expect(ev.keep).toBe(true);
    if (!ev.keep) return;
    const lead = toAlGenConLead(r, ev);
    expect(lead.sourceKey).toBe('homeservices:al:S-53030');
    expect(lead.phone).toBe('(334) 237-9279');
    expect(lead.email).toBeNull();
    expect(lead.location).toBe('Ozark, AL');
    expect(lead.typeLabel).toBe('licensed plumbing contractor');
    expect(lead.description).toBe('Listed in the Alabama Licensing Board for General Contractors licensed contractor roster as a licensed plumbing contractor, based in Ozark, AL.');
  });

  it('matches HVAC from the comma-containing specialty and electrical, but not power lines', () => {
    const hvac = evaluateAlGenConRow(row({ [AL_COL.specialty]: 'M-S: HEATING, VENTILATION AND AIR CONDITIONING' }), NOW);
    expect(hvac.keep && hvac.typeLabel).toBe('licensed HVAC contractor');
    expect(evaluateAlGenConRow(row({ [AL_COL.specialty]: 'E: ELECTRICAL' }), NOW).keep).toBe(true);
    expect(evaluateAlGenConRow(row({ [AL_COL.specialty]: 'E-S: ELECTRIC POWER LINE INSTALLATION' }), NOW).keep).toBe(false);
  });

  it('rejects with reasons', () => {
    expect(evaluateAlGenConRow(row({ [AL_COL.expiration]: '3/31/2026' }), NOW)).toEqual({ keep: false, reason: 'licence expired' });
    expect(evaluateAlGenConRow(row({ [AL_COL.specialty]: 'SUBCONTRACTOR:  CONCRETE' }), NOW)).toMatchObject({ keep: false });
    expect(evaluateAlGenConRow(row({ [AL_COL.name]: 'JOHNSON CONTROLS INC' }), NOW)).toMatchObject({ keep: false, reason: expect.stringContaining('national brand') });
    expect(evaluateAlGenConRow(row({ [AL_COL.phone]: '(   )    -' }), NOW)).toMatchObject({ keep: false, reason: expect.stringContaining('no usable phone') });
  });

  it('marks out-of-state licensees down rather than dropping them', () => {
    const ev = evaluateAlGenConRow(row({ [AL_COL.state]: 'GA', [AL_COL.city]: 'ROCKMART' }), NOW);
    expect(ev.keep && ev.reasons.some((x) => x.includes('out of state'))).toBe(true);
  });

  it('streams a BOM-prefixed CSV end to end', async () => {
    const lines = ['﻿Name,License_Number,Address,City,State,Zip,Phone_Number,fax,Bid_Limit,Specialty,Expiration_Date,Extension_Date'];
    for (let i = 0; i < 600; i++) lines.push(`ACME ROOFING ${i} LLC,S-${i},1 MAIN,MOBILE,AL,36601,(251) 555-${String(1000 + i).slice(-4)},(   )    -,,"SUBCONTRACTOR:  ROOFING",5/31/2027,`);
    lines.push('DUPE CONCRETE LLC,S-9999,1 MAIN,MOBILE,AL,36601,(251) 555-0000,(   )    -,,SUBCONTRACTOR:  CONCRETE,5/31/2027,');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(lines.join('\n'), { status: 200 })));
    const res = await streamAlGenConLeads({ now: NOW, url: 'https://example.test/roster.csv' });
    expect(res.scanned).toBe(601);
    expect(res.candidates).toHaveLength(600);
    expect(res.rejected['specialty is not an HVAC/plumbing/electrical/roofing trade']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('Kentucky child care providers', () => {
  const base: KyChildcareRow = {
    USER_CLR_: 'L350160', USER_Name: 'CHILD DEVELOPMENT CENTER OF THE BLUEGRASS', USER_County: 'FAYETTE',
    USER_Location_Address: '290 Alumni Drive, Lexington,KY,40503', USER_Phone: '(859) 218-2322', USER_Capacity: 206,
    USER_Provider_Type: 'Licensed', USER_Stars_Rating: '5', USER_Expiration_Date: Date.UTC(2027, 0, 1),
  };

  it('extracts the city from the packed address', () => {
    expect(kyCityFromAddress('290 Alumni Drive, Lexington,KY,40503')).toBe('Lexington');
    expect(kyCityFromAddress('630 Whipp Avenue, Liberty,KY,42539')).toBe('Liberty');
    expect(kyCityFromAddress('no commas')).toBeNull();
  });

  it('keeps a licensed provider and builds a childcare:ky lead', () => {
    const ev = evaluateKyChildcareRow(base, NOW);
    expect(ev.keep).toBe(true);
    if (!ev.keep) return;
    const lead = toKyChildcareLead(base, ev);
    expect(lead.sourceKey).toBe('childcare:ky:L350160');
    expect(lead.name).toBe('Child Development Center Of The Bluegrass');
    expect(lead.location).toBe('Lexington, KY');
    expect(lead.phone).toBe('(859) 218-2322');
    expect(lead.email).toBeNull();
    expect(lead.typeLabel).toBe('licensed child care provider');
    // large capacity (206) and no email both reduce the score
    expect(lead.reasons.join('|')).toContain('large licensed capacity');
  });

  it('labels certified homes and rejects chains, expired licences, other types and phoneless rows', () => {
    const cert = evaluateKyChildcareRow({ ...base, USER_Provider_Type: 'Certified', USER_Capacity: 6 }, NOW);
    expect(cert.keep && cert.typeLabel).toBe('certified family child care home');
    expect(evaluateKyChildcareRow({ ...base, USER_Name: 'KinderCare Learning Center #123' }, NOW)).toMatchObject({ keep: false });
    expect(evaluateKyChildcareRow({ ...base, USER_Expiration_Date: Date.UTC(2026, 0, 1) }, NOW)).toEqual({ keep: false, reason: 'licence expired' });
    expect(evaluateKyChildcareRow({ ...base, USER_Provider_Type: 'Exempt' }, NOW)).toMatchObject({ keep: false });
    expect(evaluateKyChildcareRow({ ...base, USER_Phone: '' }, NOW)).toMatchObject({ keep: false });
  });

  it('pages the ArcGIS query past one page', async () => {
    const mk = (i: number) => ({ attributes: { ...base, USER_CLR_: `L${i}`, USER_Name: `Tiny Tots ${i}` } });
    const pages = [Array.from({ length: 1000 }, (_, i) => mk(i)), Array.from({ length: 5 }, (_, i) => mk(1000 + i))];
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ features: pages[call++] ?? [] }), { status: 200 })));
    const res = await allKyChildcareLeads({ now: NOW });
    expect(call).toBe(2);
    expect(res.scanned).toBe(1005);
    expect(res.candidates).toHaveLength(1005);
    expect(res.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A real (tiny) xlsx: a hand-assembled zip with sharedStrings + sheet1, one member
// deflated and one stored, so both zip methods are exercised.
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function makeZip(files: { name: string; data: string; deflate: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = Buffer.from(f.data, 'utf8');
    const body = f.deflate ? deflateRawSync(raw) : raw;
    const name = Buffer.from(f.name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(f.deflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(f.deflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const HEADER = ['RowNo.', 'License #', 'Name of Licensee Legal Name', '', '', 'DBA Name', 'Facility Contact Name', '', 'Facility Contact Number', 'Facility Fax', '', 'Director Name', 'Director Title', 'Owner Name', 'Site Address', 'Site City', 'Site State', 'Site Zip', 'Facility Address', 'Facility Address 2', 'Facility City', 'Facility State', 'Facility Zip', 'County ', 'Home Care Services', 'Expiry Date'];
const dataRow = (n: number, lic: string, legal: string, dba: string, phone: string, city: string, services: string, expiry = '31-Dec-26') =>
  [String(n), lic, legal, '', '', dba, 'Sarah Lamberth', '', phone, '', '', '', '', '', '1 Main St', city, 'NC', '27215', '', '', city, 'NC', '27215', 'Alamance ', services, expiry];

function buildSheet(rows: string[][]): { shared: string; sheet: string } {
  const strings: string[] = [];
  const idx = (s: string) => { let i = strings.indexOf(s); if (i < 0) { strings.push(s); i = strings.length - 1; } return i; };
  const letter = (i: number) => String.fromCharCode(65 + i);
  const body = rows.map((r, ri) => `<row r="${ri + 4}">${r.map((v, ci) => (v === '' ? '' : `<c r="${letter(ci)}${ri + 4}" t="s"><v>${idx(v)}</v></c>`)).join('')}</row>`).join('');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return {
    shared: `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`,
    sheet: `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Home Care All &amp; stuff</t></is></c></row>${body}</sheetData></worksheet>`,
  };
}

describe('North Carolina DHSR home care list (xlsx)', () => {
  const rows = [
    HEADER,
    dataRow(1, 'HC6257', 'Happier Days Private Duty Services, LLC', 'Happier Days Private Duty Services, LLC', '(336) 270-8052', 'Burlington', 'Companion, Sitter and Respite,In-Home Aide'),
    dataRow(2, 'HC6645', 'Griswold Properties LLC', 'Griswold Home Care', '(336) 285-7477', 'Burlington', 'Companion, Sitter and Respite,In-Home Aide'),
    dataRow(3, 'HC7001', 'Carolina Skilled Nursing Inc', 'Carolina Skilled Home Health', '(919) 555-0101', 'Raleigh', 'In-Home Aide,Nursing Care,Physical Therapy'),
    dataRow(4, 'HC7002', 'Pool Staff LLC', 'Pool Staff', '(919) 555-0102', 'Raleigh', 'Nursing Pool Service'),
    dataRow(5, 'HC7003', 'Old Agency LLC', 'Old Agency', '(919) 555-0103', 'Raleigh', 'In-Home Aide', '31-Dec-24'),
    dataRow(6, 'HC7004', 'No Phone Care LLC', 'No Phone Care', '', 'Raleigh', 'In-Home Aide'),
    dataRow(7, 'HC7005', 'Duke Health Home Services', 'Duke Home Care', '(919) 555-0104', 'Durham', 'In-Home Aide'),
  ];
  const { shared, sheet } = buildSheet(rows);
  const xlsx = makeZip([
    { name: 'xl/sharedStrings.xml', data: shared, deflate: true },
    { name: 'xl/worksheets/sheet1.xml', data: sheet, deflate: false },
  ]);

  it('reads cells, shared strings and column letters', () => {
    expect(colIndex('A1')).toBe(0);
    expect(colIndex('AB7')).toBe(27);
    expect(parseSharedStrings('<sst><si><t>a &amp; b</t></si><si><r><t>x</t></r><r><t>y</t></r></si></sst>')).toEqual(['a & b', 'xy']);
    const got = parseSheetRows('<sheetData><row r="1"><c r="B1" t="s"><v>0</v></c><c r="D1"><v>7</v></c></row></sheetData>', ['hi']);
    expect(got).toEqual([['', 'hi', '', '7']]);
  });

  it('parses the DHSR date format', () => {
    expect(parseNcDate('31-Dec-26')?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(parseNcDate('nope')).toBeNull();
  });

  it('extracts the current xlsx link from the reports page', () => {
    expect(findHclistLink('<a href="data/hclist.xlsx?ver=2.6">XLSX</a>')).toBe('https://info.ncdhhs.gov/dhsr/data/hclist.xlsx?ver=2.6');
    expect(findHclistLink('<a href="data/other.xlsx">x</a>')).toBeNull();
  });

  it('reads the zip, finds the header below the title line, and evaluates each row', async () => {
    const parsed = parseNcHomecareSheet(await readXlsxFirstSheet(xlsx));
    expect(parsed).toHaveLength(7);
    const ev = parsed.map((r) => evaluateNcHomecareRow(r, NOW));
    expect(ev.map((e) => e.keep)).toEqual([true, true, true, false, false, false, true]);
    expect(ev[3]).toMatchObject({ reason: expect.stringContaining('not in-home care') });
    expect(ev[4]).toEqual({ keep: false, reason: 'licence expired' });
    expect(ev[5]).toMatchObject({ reason: expect.stringContaining('no usable phone') });
    // a health-system brand is kept (still a licensed agency) but scored down 20
    expect(ev[6].keep && ev[6].reasons.join('|')).toContain('health system');

    const first = ev[0];
    if (!first.keep) throw new Error('expected keep');
    const lead = toNcHomecareLead(parsed[0], first);
    expect(lead.sourceKey).toBe('homecare:nc:HC6257');
    expect(lead.phone).toBe('(336) 270-8052');
    expect(lead.location).toBe('Burlington, NC');
    expect(lead.email).toBeNull();
    expect(lead.contactName).toBe('Sarah Lamberth');
    expect(lead.legalName).toBeNull();
    // the franchise brand is kept but heavily marked down; the skilled agency is marked down for reading medical
    const chain = ev[1];
    expect(chain.keep && chain.adjust).toBeLessThan(first.adjust);
    expect(toNcHomecareLead(parsed[1], chain as never).legalName).toBe('Griswold Properties LLC');
  });

  it('allNcHomecareLeads reports a clear error on a short file', async () => {
    const res = await allNcHomecareLeads({ now: NOW, buf: xlsx });
    expect(res.errors[0]).toContain('only 7 rows');
    expect(res.candidates).toHaveLength(0);
  });
});
