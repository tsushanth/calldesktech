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

  it('drops out-of-state licensees by default and keeps them with includeOutOfState', () => {
    const r = row({ [AL_COL.state]: 'GA', [AL_COL.city]: 'ROCKMART' });
    expect(evaluateAlGenConRow(r, NOW)).toEqual({ keep: false, reason: 'based outside Alabama' });
    expect(evaluateAlGenConRow(r, NOW, { includeOutOfState: true }).keep).toBe(true);
  });

  it('excludes person-named and DBA-of-a-person licensees from callers phone lists, never real businesses', () => {
    const lead = (name: string) => { const r = row({ [AL_COL.name]: name }); const ev = evaluateAlGenConRow(r, NOW); if (!ev.keep) throw new Error('keep'); return toAlGenConLead(r, ev); };
    const p = lead('STEPHEN KELLON POPE');
    expect(p.callerPhoneExcluded).toBe('person-named business');
    expect(p.signalDetail).not.toMatch(/\(\d{3}\) \d{3}-\d{4}/);
    expect(p.description).toContain('Listed in the Alabama Licensing Board');
    expect(lead('JOHN W SMITH DBA SMITH ROOFING').callerPhoneExcluded).toBe('sole proprietor');
    for (const n of ["BILLY DON'S AIR", 'CHARLES FIX IT ALL', 'COOL TEMP', 'HI TECH', 'PRIME CONTROLS LP', 'WEEKS SHEETMETAL', 'FLANAGAN PLUMBING LLC', 'ALPHA ACME ELECTRIC INC'])
      expect(lead(n).callerPhoneExcluded, n).toBeNull();
    expect(lead('FLANAGAN PLUMBING LLC').signalDetail).toContain('(334) 237-9279');
  });

  it('fails (does not import a prefix) on a truncated roster', async () => {
    const lines = ['Name,License_Number,Address,City,State,Zip,Phone_Number,fax,Bid_Limit,Specialty,Expiration_Date,Extension_Date'];
    for (let i = 0; i < 600; i++) lines.push(`ACME ROOFING ${i} LLC,S-${i},1 MAIN,MOBILE,AL,36601,(251) 555-1000,(   )    -,,"SUBCONTRACTOR:  ROOFING",5/31/2027,`);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(lines.join('\n'), { status: 200 })));
    await expect(streamAlGenConLeads({ now: NOW, url: 'https://example.test/roster.csv' })).rejects.toThrow(/only 600 rows/);
  });

  it('streams a BOM-prefixed CSV end to end', async () => {
    const lines = ['﻿Name,License_Number,Address,City,State,Zip,Phone_Number,fax,Bid_Limit,Specialty,Expiration_Date,Extension_Date'];
    for (let i = 0; i < 3000; i++) lines.push(`ACME ROOFING ${i} LLC,S-${i},1 MAIN,MOBILE,AL,36601,(251) 555-${String(1000 + i).slice(-4)},(   )    -,,"SUBCONTRACTOR:  ROOFING",5/31/2027,`);
    lines.push('DUPE CONCRETE LLC,S-9999,1 MAIN,MOBILE,AL,36601,(251) 555-0000,(   )    -,,SUBCONTRACTOR:  CONCRETE,5/31/2027,');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(lines.join('\n'), { status: 200 })));
    const res = await streamAlGenConLeads({ now: NOW, url: 'https://example.test/roster.csv' });
    expect(res.scanned).toBe(3001);
    expect(res.candidates).toHaveLength(3000);
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

  // ArcGIS mock keyed on the query: honours resultOffset/resultRecordCount and returnCountOnly, with a hard server cap.
  const arcgis = (total: number, cap = 2000, countOverride?: number) => vi.fn(async (url: string) => {
    const q = new URL(url).searchParams;
    if (q.get('returnCountOnly')) return new Response(JSON.stringify({ count: countOverride ?? total }), { status: 200 });
    const off = Number(q.get('resultOffset') ?? 0);
    const n = Math.min(Number(q.get('resultRecordCount') ?? cap), cap, Math.max(0, total - off));
    const features = Array.from({ length: n }, (_, i) => ({ attributes: { ...base, USER_CLR_: `L${off + i}`, USER_Name: `Tiny Tots ${off + i}`, USER_Capacity: 40 } }));
    return new Response(JSON.stringify({ features, exceededTransferLimit: off + n < total && n === cap }), { status: 200 });
  });

  it('pages past maxRecordCount: 2,001 rows come back as 2,001 with no off-by-one', async () => {
    vi.stubGlobal('fetch', arcgis(2001));
    const res = await allKyChildcareLeads({ now: NOW });
    expect(res.errors).toEqual([]);
    expect(res.scanned).toBe(2001);
    expect(res.candidates).toHaveLength(2001);
    expect(new Set(res.candidates.map((c) => c.sourceKey)).size).toBe(2001);
  });

  it('handles a layer that is an exact multiple of the page size', async () => {
    vi.stubGlobal('fetch', arcgis(2000));
    const res = await allKyChildcareLeads({ now: NOW });
    expect(res.scanned).toBe(2000);
  });

  it('throws rather than return a partial layer when the paged rows fall short of the layer count', async () => {
    vi.stubGlobal('fetch', arcgis(1200, 2000, 2001));
    const res = await allKyChildcareLeads({ now: NOW });
    expect(res.candidates).toHaveLength(0);
    expect(res.errors[0]).toContain('refusing a partial import');
  });

  it('excludes certified family homes and home-sized licensed providers from callers lists, keeps centres', () => {
    const lead = (o: Partial<KyChildcareRow>) => { const r = { ...base, ...o }; const ev = evaluateKyChildcareRow(r, NOW); if (!ev.keep) throw new Error('keep'); return toKyChildcareLead(r, ev); };
    const cert = lead({ USER_Provider_Type: 'Certified', USER_Capacity: 6, USER_Name: 'Tammys Daycare' });
    expect(cert.callerPhoneExcluded).toBe('home-based provider');
    expect(cert.signalDetail).not.toMatch(/\(\d{3}\) \d{3}-\d{4}/);
    expect(cert.location).toBe('Lexington, KY'); // registry facts kept
    expect(lead({ USER_Capacity: 12, USER_Name: "Pat's Day Care" }).callerPhoneExcluded).toBe('home-based provider');
    expect(lead({ USER_Capacity: 40, USER_Name: 'Little Lea In-Home Montessori Daycare' }).callerPhoneExcluded).toBe('home-based provider');
    expect(lead({ USER_Provider_Type: 'Certified', USER_Capacity: 6, USER_Name: 'Rosshell Masden' }).callerPhoneExcluded).toBe('home-based provider');
    for (const n of ['Bobcat Mountain', 'Liberty Head Start', 'Happy Bears', 'Busy Bees Educare', 'Child Development Center Of The Bluegrass'])
      expect(lead({ USER_Name: n, USER_Capacity: 60 }).callerPhoneExcluded, n).toBeNull();
    expect(lead({ USER_Name: 'Liberty Head Start', USER_Capacity: 60 }).signalDetail).toContain('(859) 218-2322');
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

describe('North Carolina DHSR: reader robustness, medical scoring, caller-phone policy', () => {
  const zipOf = (rows: string[][], extra: { name: string; data: string; deflate: boolean }[] = [], sheetXml?: string) => {
    const { shared, sheet } = buildSheet(rows);
    return makeZip([{ name: 'xl/sharedStrings.xml', data: shared, deflate: true }, { name: 'xl/worksheets/sheet1.xml', data: sheetXml ?? sheet, deflate: true }, ...extra]);
  };

  it('does not let a self-closed blank row swallow the next row', () => {
    const got = parseSheetRows('<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row><row r="2"/><row r="3"><c r="A3" t="inlineStr"><is><t>b</t></is></c></row></sheetData>', []);
    expect(got).toEqual([['a'], [], ['b']]);
  });

  it('reads cells with no r= attribute, <v> attributes, rich text and ignores phonetic runs', () => {
    expect(parseSheetRows('<sheetData><row><c t="inlineStr"><is><t>x</t></is></c><c><v xml:space="preserve">5</v></c></row></sheetData>', [])).toEqual([['x', '5']]);
    expect(parseSharedStrings('<sst><si><t>ab</t><rPh sb="0" eb="1"><t>FURI</t></rPh></si><si/><si><t>c</t></si></sst>')).toEqual(['ab', '', 'c']);
  });

  it('finds the first sheet through workbook.xml and its rels, not a hard-coded sheet1', async () => {
    const rows = [HEADER, ...Array.from({ length: 600 }, (_, i) => dataRow(i + 1, `HC${i}`, `Agency ${i} LLC`, `Agency ${i} LLC`, '(336) 270-8052', 'Burlington', 'In-Home Aide'))];
    const { shared, sheet } = buildSheet(rows);
    const buf = makeZip([
      { name: 'xl/workbook.xml', data: '<workbook><sheets><sheet name="s" sheetId="1" r:id="rId9"/></sheets></workbook>', deflate: true },
      { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId9" Type="x" Target="worksheets/data.xml"/></Relationships>', deflate: true },
      { name: 'xl/sharedStrings.xml', data: shared, deflate: true },
      { name: 'xl/worksheets/data.xml', data: sheet, deflate: true },
    ]);
    expect(parseNcHomecareSheet(await readXlsxFirstSheet(buf))).toHaveLength(600);
  });

  it('parses an Excel serial date, and refuses a file whose dates are unreadable instead of returning an empty success', async () => {
    expect(parseNcDate('46387')?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    const rows = [HEADER, ...Array.from({ length: 600 }, (_, i) => dataRow(i + 1, `HC${i}`, `Agency ${i} LLC`, `Agency ${i} LLC`, '(336) 270-8052', 'Burlington', 'In-Home Aide', 'garbage'))];
    const res = await allNcHomecareLeads({ now: NOW, buf: zipOf(rows) });
    expect(res.errors[0]).toContain('unreadable expiry');
    expect(res.candidates).toHaveLength(0);
  });

  it('scores medical agencies down and rejects DME / respiratory suppliers', () => {
    const ev = (services: string, legal = 'Sunny Care LLC') => evaluateNcHomecareRow({ license: 'HC1', legalName: legal, dba: null, owner: null, contactName: null, phone: '(919) 555-0101', siteCity: 'Cary', facilityCity: null, state: 'NC', county: null, services, expiry: '31-Dec-26' }, NOW);
    const aideOnly = ev('Companion, Sitter and Respite,In-Home Aide');
    const mixed = ev('Companion, Sitter and Respite,In-Home Aide,Nursing Care,Physical Therapy');
    const skilledOnly = ev('Nursing Care');
    if (!aideOnly.keep || !mixed.keep || !skilledOnly.keep) throw new Error('keep');
    expect(mixed.adjust).toBe(aideOnly.adjust - 8);
    expect(skilledOnly.adjust).toBeLessThan(mixed.adjust);
    expect(skilledOnly.typeLabel).toContain('skilled nursing');
    expect(ev('Companion, Sitter and Respite,Durable Medical Equipment,Clinical Respiratory Services (including Pulmonary)')).toMatchObject({ keep: false, reason: expect.stringContaining('equipment') });
    expect(ev('Nursing Pool Service')).toMatchObject({ keep: false });
  });

  it('excludes an individually owned agency from callers lists but not branded or company businesses', () => {
    const lead = (legal: string, dba: string, owner: string) => {
      const r = { license: 'HC9', legalName: legal, dba, owner, contactName: 'Pat', phone: '(919) 555-0101', siteCity: 'Cary', facilityCity: null, state: 'NC', county: 'Wake', services: 'In-Home Aide', expiry: '31-Dec-26' };
      const ev = evaluateNcHomecareRow(r, NOW); if (!ev.keep) throw new Error('keep'); return toNcHomecareLead(r, ev);
    };
    const sole = lead('Pamela Spence Devore', 'Personal Touch Assisted Living', 'Pamela S DeVore');
    expect(sole.callerPhoneExcluded).toBe('sole proprietor');
    expect(sole.signalDetail).not.toMatch(/\(\d{3}\) \d{3}-\d{4}/);
    expect(sole.contactName).toBe('Pat'); // registry facts kept
    expect(sole.location).toBe('Cary, NC');
    for (const [l, d, o] of [
      ['Visiting Angels Of Catawba Valley LLC', 'Visiting Angels', 'Visiting Angels Of Catawba Valley LLC'],
      ['AuthoraCare Collective', 'AuthoraCare Collective', 'AuthoraCare Collective'],
      ['Carolina SeniorCare', 'Carolina SeniorCare', 'Carolina SeniorCare'],
      ['Senior Helpers', 'Senior Helpers', 'Pickus Ventures LLC'],
      ['Highland Investors Limited Partnership', 'Lake Pointe Landing Home Care', 'Highland Investors Limited Partnership'],
      ['Grace Ridge', 'Grace Ridge', 'Grace Ridge'],
      ['Making Visions', 'Making Visions', 'Making Visions'],
      ['Patience Chile Ndikom', 'Ideal Home Health Services, Inc.', 'Ideal Home Health Services, Inc.'], // person licensee, company owner: not corroborated
    ]) expect(lead(l, d, o).callerPhoneExcluded, l).toBeNull();
    expect(lead('Happier Days Private Duty Services, LLC', 'Happier Days Private Duty Services, LLC', 'Happier Days Private Duty Services, LLC').signalDetail).toContain('(919) 555-0101');
  });
});
