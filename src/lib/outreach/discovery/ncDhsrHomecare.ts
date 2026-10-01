import { DISCOVERY_UA } from './http';
import { findEocd, parseCentralDirectory } from './zipStream';
import { classifyHomecareName } from './homecareRegistry';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';

// Home-care discovery from the North Carolina DHHS Division of Health Service
// Regulation "Home Care All" licensed-agency list, an .xlsx published on
// https://info.ncdhhs.gov/dhsr/reports.htm (link text "XLSX", file data/hclist.xlsx
// with a ?ver= cache-buster that changes on every refresh, so the link is
// scraped rather than hard-coded; the last known URL is only a fallback).
//
// Verified 2026-09-30 ("As of 08/2026" in the sheet title): 3,335 licensed home
// care agencies, 100% with a facility contact phone, NO email column. 3,302 expire
// 2026-12-31 (the annual licence cycle), 32 in 2027, 1 already expired. Services:
// "Companion, Sitter and Respite" + "In-Home Aide" are the non-medical care that
// fits the homecare vertical (2,213 rows list exactly those two); the rest add
// nursing, therapy, infusion, DME and nursing-pool services.
//
// No xlsx library is in package.json and none may be added, so the minimal OOXML
// read is done here: zip central directory (zipStream) + node:zlib inflate +
// sharedStrings + sheet XML. node:zlib is imported lazily, like zipStream.

export const NC_DHSR_REPORTS_URL = 'https://info.ncdhhs.gov/dhsr/reports.htm';
export const NC_DHSR_FALLBACK_XLSX = 'https://info.ncdhhs.gov/dhsr/data/hclist.xlsx';
export const NC_DHSR_REGISTRY = 'North Carolina Division of Health Service Regulation';
const LIST_NOUN = 'licensed home care agency list';

// ---- minimal xlsx reader ---------------------------------------------------

function xmlUnescape(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    let s = '';
    for (const t of m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += t[1];
    out.push(xmlUnescape(s));
  }
  return out;
}

// "AB12" -> 27 (0-based column index)
export function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function parseSheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      const type = /\bt="([^"]*)"/.exec(attrs)?.[1] ?? 'n';
      const body = cm[2] ?? '';
      let val = '';
      if (type === 'inlineStr') {
        for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) val += t[1];
        val = xmlUnescape(val);
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
        val = type === 's' ? (shared[Number(v)] ?? '') : xmlUnescape(v);
      }
      row[colIndex(ref)] = val;
    }
    rows.push(Array.from(row, (c) => c ?? ''));
  }
  return rows;
}

export async function readZipMember(buf: Buffer, name: string): Promise<Buffer | null> {
  const { inflateRawSync } = await import('node:zlib');
  const eocd = findEocd(buf.subarray(Math.max(0, buf.length - 66_000)));
  const entries = parseCentralDirectory(buf.subarray(eocd.offset, eocd.offset + eocd.size), eocd.count);
  const e = entries.find((x) => x.name === name);
  if (!e) return null;
  const nameLen = buf.readUInt16LE(e.offset + 26);
  const extraLen = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) return inflateRawSync(data);
  throw new Error(`xlsx member ${name}: unsupported zip method ${e.method}`);
}

export async function readXlsxFirstSheet(buf: Buffer): Promise<string[][]> {
  const sheet = await readZipMember(buf, 'xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('xlsx has no xl/worksheets/sheet1.xml');
  const ss = await readZipMember(buf, 'xl/sharedStrings.xml');
  return parseSheetRows(sheet.toString('utf8'), ss ? parseSharedStrings(ss.toString('utf8')) : []);
}

// ---- rows ------------------------------------------------------------------

export interface NcHomecareRow {
  license: string;
  legalName: string;
  dba: string | null;
  contactName: string | null;
  phone: string | null;
  siteCity: string | null;
  facilityCity: string | null;
  state: string | null;
  county: string | null;
  services: string;
  expiry: string | null;
}

// Header cells vary only in trailing spaces ("County "), so columns are located by name.
export function ncColumns(header: string[]): Record<string, number> | null {
  const idx: Record<string, number> = {};
  header.forEach((h, i) => {
    const k = (h ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (k && !(k in idx)) idx[k] = i;
  });
  const need = ['license #', 'facility contact number', 'home care services', 'expiry date'];
  return need.every((k) => k in idx) ? idx : null;
}

export function toNcHomecareRow(cols: Record<string, number>, r: string[]): NcHomecareRow {
  const g = (k: string) => ((r[cols[k]] ?? '') as string).replace(/\s+/g, ' ').trim();
  const legalKey = Object.keys(cols).find((k) => k.startsWith('name of licensee')) ?? '';
  return {
    license: g('license #'),
    legalName: legalKey ? g(legalKey) : '',
    dba: g('dba name') || null,
    contactName: g('facility contact name') || null,
    phone: g('facility contact number') || null,
    siteCity: g('site city') || null,
    facilityCity: g('facility city') || null,
    state: g('site state') || g('facility state') || null,
    county: g('county') || null,
    services: g('home care services'),
    expiry: g('expiry date') || null,
  };
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// "31-Dec-26"
export function parseNcDate(raw: string | null | undefined): Date | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec((raw ?? '').trim());
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (mon === undefined) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return new Date(Date.UTC(y, mon, Number(m[1])));
}

const NC_HEALTH_SYSTEM = /\b(atrium|novant|duke|unc health|wakemed|cone health|vidant|ecu health|mission health|baptist|wake forest|first health|carolinas healthcare|\bvitas\b|kindred|amedisys|encompass health|enhabit|gentiva|accentcare|bayada|\bbrookdale\b|interim healthcare|home instead|visiting angels|comfort keepers|right at home|senior helpers|homewatch|synergy homecare|bright star|caring senior service|always best care|griswold)\b/i;

export type Evaluation = { keep: true; adjust: number; reasons: string[]; typeLabel: string } | { keep: false; reason: string };

export function evaluateNcHomecareRow(r: NcHomecareRow, now = new Date()): Evaluation {
  if (!r.license) return { keep: false, reason: 'no licence number' };
  const display = r.dba || r.legalName;
  if (!display) return { keep: false, reason: 'no agency name' };
  const exp = parseNcDate(r.expiry);
  if (!exp || exp.getTime() < now.getTime()) return { keep: false, reason: 'licence expired' };
  const svc = r.services.toLowerCase();
  const aide = /in-home aide|companion/.test(svc);
  const nursing = /nursing care/.test(svc);
  if (!aide && !nursing) return { keep: false, reason: 'service set is not in-home care (e.g. DME, nursing pool or infusion only)' };
  const phone = formatUsPhone(r.phone);
  if (!phone) return { keep: false, reason: 'no usable phone (the list has no email)' };

  const cls = classifyHomecareName(display, r.legalName);
  if (!cls.keep) return cls;
  let adjust = cls.adjust;
  const reasons = [...cls.reasons];
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };
  if (NC_HEALTH_SYSTEM.test(`${display} ${r.legalName}`)) add(-20, 'part of a large health system or national home-care / home-health chain');
  if (aide && !nursing) add(4, 'licensed for in-home aide / companion care only (non-medical fit)');
  add(-10, 'no published email in the list (phone only)');
  return { keep: true, adjust, reasons, typeLabel: aide ? 'licensed home care agency' : 'licensed home care agency (nursing)' };
}

export function toNcHomecareLead(r: NcHomecareRow, ev: { adjust: number; reasons: string[]; typeLabel: string }): RegistryLead {
  const raw = r.dba || r.legalName;
  const name = titleCase(raw);
  const legalName = r.legalName && r.dba && r.legalName.toUpperCase() !== r.dba.toUpperCase() ? titleCase(r.legalName) : null;
  const city = r.siteCity || r.facilityCity;
  const location = cityState(city, (r.state ?? 'NC').toUpperCase());
  const phone = formatUsPhone(r.phone);
  const licenseId = r.license.toUpperCase();
  return {
    sourceKey: `homecare:nc:${licenseId}`,
    name,
    legalName,
    city: city ? titleCase(city) : null,
    state: (r.state ?? 'NC').toUpperCase(),
    phone,
    licenseId,
    registryName: NC_DHSR_REGISTRY,
    typeLabel: ev.typeLabel,
    // The listed facility contact is a named person; kept for a human call only.
    contactName: r.contactName,
    location,
    description: describeRegistryLead({ typeLabel: ev.typeLabel, registryName: NC_DHSR_REGISTRY, location, legalName, name, listNoun: LIST_NOUN }),
    signalDetail: `NC DHSR home care licence ${licenseId}${r.county ? `, ${titleCase(r.county)} County` : ''}${phone ? `; facility phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: null,
    contactSourceUrl: null,
  };
}

// ---- network ---------------------------------------------------------------

export function findHclistLink(html: string): string | null {
  const m = /href="([^"]*\/?data\/hclist\.xlsx[^"]*)"/i.exec(html);
  if (!m) return null;
  return new URL(m[1].replace(/&amp;/g, '&'), NC_DHSR_REPORTS_URL).toString();
}

async function fetchBuf(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': DISCOVERY_UA, Accept: '*/*' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} unavailable (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export function parseNcHomecareSheet(rows: string[][]): NcHomecareRow[] {
  let cols: Record<string, number> | null = null;
  const out: NcHomecareRow[] = [];
  for (const r of rows) {
    if (!cols) { cols = ncColumns(r); continue; }
    if (!(r[cols['license #']] ?? '').trim()) continue;
    out.push(toNcHomecareRow(cols, r));
  }
  if (!cols) throw new Error('NC home care list: header row not found; layout may have changed');
  return out;
}

export async function allNcHomecareLeads(
  opts: { now?: Date; isKnown?: (sourceKey: string) => boolean; buf?: Buffer; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();
  try {
    let buf = opts.buf;
    if (!buf) {
      const page = await fetch(NC_DHSR_REPORTS_URL, { headers: { 'User-Agent': DISCOVERY_UA } });
      const link = page.ok ? findHclistLink(await page.text()) : null;
      const url = link ?? NC_DHSR_FALLBACK_XLSX;
      opts.log?.(`nc homecare: ${url}`);
      buf = await fetchBuf(url);
    }
    const rows = parseNcHomecareSheet(await readXlsxFirstSheet(buf));
    if (rows.length < 500) throw new Error(`only ${rows.length} rows; file layout may have changed`);
    for (const r of rows) {
      result.scanned++;
      const ev = evaluateNcHomecareRow(r, now);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      const lead = toNcHomecareLead(r, ev);
      if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); continue; }
      result.candidates.push(lead);
    }
  } catch (e) {
    result.errors.push(`homecare nc: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
