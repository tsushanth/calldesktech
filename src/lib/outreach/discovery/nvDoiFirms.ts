import { parseCsv } from './csvStream';
import { cleanEmail, isFreeMail } from './freightFmcsa';
import { DISCOVERY_UA } from './http';
import { looksLikeIndividual } from './individualName';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';

// Insurance, bail-bonds and funeral discovery from the Nevada Division of
// Insurance "Reports & Lists > Firms by License Type" report
// (https://di.nv.gov/nv/r/doi/reports-and-lookups/home), an Oracle APEX
// interactive report with an official "Download" button. No login, no captcha;
// the page is the Division's own public self-serve list.
//
// Verified 2026-09-30 (CSV download of each firm license type):
//   Resident Producer Firm   1,983 rows, 96.8% email, 98.1% phone, 1,843 NV addresses
//   Resident Bail Agency        67 rows, 97.0% email, 73.1% phone
//   Resident Funeral Seller     18 rows, 100% email, 100% phone
// Freshest original-issue date 2026-09-28; the export is live, so it is as fresh
// as the Division's own licensing system.
//
// How the download works: GET the report page with the license type in the query
// string (p20_type=<exact label>, p20_hs=Y shows the address/contact columns) so
// APEX stores it in the session, then GET the same page with
// request=IR[xlsx]_CSV, which streams the whole report as CSV (the xlsx variant
// is IR[xlsx]_XLSX_N, not used here to avoid an unzip dependency). The session
// cookie must be carried across the two calls.
//
// NOT used: the Division's "Resident/Non-Resident Producer List" xlsx files list
// INDIVIDUAL agents with personal emails, not businesses.
//
// A "producer firm" is a firm licensed to sell insurance; the file also holds
// storage, rental-car and travel companies licensed to sell limited-line
// insurance, which NAME_JUNK removes.

export const NV_DOI_BASE = 'https://di.nv.gov/nv/r/doi/reports-and-lookups/firms-by-license-type';
export const NV_DOI_SOURCE_URL = 'https://di.nv.gov/nv/r/doi/reports-and-lookups/home';
export const NV_DOI_REGISTRY = 'Nevada Division of Insurance';
const LIST_NOUN = 'licensee list';

export type NvDoiVertical = 'insurance' | 'bailbonds' | 'funeral';

export const NV_DOI_TYPES: Record<NvDoiVertical, { licenseType: string; typeLabel: string }[]> = {
  insurance: [{ licenseType: 'Resident Producer Firm', typeLabel: 'licensed insurance producer firm' }],
  bailbonds: [{ licenseType: 'Resident Bail Agency', typeLabel: 'licensed bail agency' }],
  funeral: [{ licenseType: 'Resident Funeral Seller', typeLabel: 'licensed funeral seller' }],
};

export const NV_COL = {
  type: 'Firm License Type',
  license: 'License',
  name: 'Name',
  city: 'City',
  state: 'State',
  zip: 'Zip',
  phone: 'Phone',
  email: 'Email',
  issued: 'Original Issue Date',
  expires: 'Expiration Date',
} as const;

export interface NvDoiRow {
  licenseType: string;
  license: string;
  name: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  issued: string | null;
  expires: string | null;
}

// Header cells carry stray trailing spaces ("License ", "Original Issue Date ").
export function toNvDoiRow(o: Record<string, string>): NvDoiRow {
  const g = (k: string) => (o[k] ?? o[`${k} `] ?? '').trim();
  const v = (k: string) => g(k) || null;
  return {
    licenseType: g(NV_COL.type),
    license: g(NV_COL.license),
    name: g(NV_COL.name).replace(/\s+/g, ' '),
    // "Las Vegas (Clark)" -> "Las Vegas"
    city: (g(NV_COL.city).replace(/\s*\([^)]*\)\s*$/, '').trim()) || null,
    state: v(NV_COL.state),
    zip: v(NV_COL.zip),
    phone: v(NV_COL.phone),
    email: v(NV_COL.email),
    issued: v(NV_COL.issued),
    expires: v(NV_COL.expires),
  };
}

// The report writes M/D/YYYY.
export function parseNvDate(raw: string | null | undefined): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((raw ?? '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
  return Number.isNaN(d.getTime()) ? null : d;
}

export type Evaluation = { keep: true; adjust: number; reasons: string[] } | { keep: false; reason: string };

const BIG_INSURANCE = /\b(state farm|allstate|farmers insurance|geico|progressive|liberty mutual|nationwide|american family|usaa|travelers|the hartford|aaa\b|marsh|mclennan|aon\b|gallagher|brown\s*&\s*brown|\busi\b|hub international|acrisure|alliant insurance|nfp corp|lockton|willis towers|risk strategies|goosehead|policygenius|safeco|foremost)\b/i;
const BIG_BAIL = /\b(aladdin bail|bad boys bail|all ?pro bail|lexington national|american bankers insurance|financial casualty|allegheny casualty|international fidelity)\b/i;
const BIG_FUNERAL = /\b(dignity memorial|service corporation international|\bsci\b|stewart enterprises|carriage services|park lawn|funeral directors life)\b/i;
// Limited-line licensees that are not insurance agencies.
const NAME_JUNK = /\b(self[- ]?storage|storage|credit union|\bfcu\b|\bbank\b|car rental|rent[- ]a[- ]car|autobarn|travel|warranty|title (insurance|agency)|adjust(ing|ers?)|premium finance|mortgage)\b/i;
const CAPTIVE_DOMAIN = /^(.*\.)?(statefarm|allstate|farmersagent|farmersagency|farmersinsurance|geico|progressive|libertymutual|amfam|amfamagent|nationwide|usaa|thehartford|travelers|goosehead|aaa|shelterinsurance|countryfinancial|americanfamily)\.(com|net|org)$/i;

export function evaluateNvDoiRow(r: NvDoiRow, vertical: NvDoiVertical, now = new Date()): Evaluation {
  if (!NV_DOI_TYPES[vertical].some((t) => t.licenseType === r.licenseType)) return { keep: false, reason: 'licence type not in scope' };
  if (!r.license) return { keep: false, reason: 'no licence number' };
  if (!r.name) return { keep: false, reason: 'no business name' };
  const exp = parseNvDate(r.expires);
  if (!exp || exp.getTime() < now.getTime()) return { keep: false, reason: 'licence expired' };
  if (NAME_JUNK.test(r.name)) return { keep: false, reason: 'storage, rental, bank or title/adjusting firm (not an agency)' };
  const big = vertical === 'insurance' ? BIG_INSURANCE : vertical === 'bailbonds' ? BIG_BAIL : BIG_FUNERAL;
  if (big.test(r.name)) return { keep: false, reason: 'captive/national carrier, large brokerage or national chain name' };
  const email = cleanEmail(r.email);
  if (email && CAPTIVE_DOMAIN.test(email.split('@')[1] ?? '')) return { keep: false, reason: 'carrier-domain email (captive agent)' };
  const phone = formatUsPhone(r.phone);
  if (!email && !phone) return { keep: false, reason: 'no email and no phone' };

  let adjust = 0;
  const reasons: string[] = [];
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };
  if (!email) add(-10, 'no published email in the licensee list');
  else if (isFreeMail(email)) add(-5, 'contact is a free-mail address (no business domain to verify)');
  else add(5, 'business-domain email published in the licensee list');
  if (!phone) add(-5, 'no usable phone in the licensee list');
  if (looksLikeIndividual(r.name)) add(-3, 'firm name is a person name (sole proprietor)');
  if (r.state && r.state.toUpperCase() !== 'NV') add(-3, 'Nevada-resident licence but address is out of state');
  return { keep: true, adjust, reasons };
}

export function toNvDoiLead(r: NvDoiRow, vertical: NvDoiVertical, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const name = titleCase(r.name);
  const state = (r.state || 'NV').toUpperCase();
  const location = cityState(r.city, state);
  const typeLabel = NV_DOI_TYPES[vertical].find((t) => t.licenseType === r.licenseType)?.typeLabel ?? NV_DOI_TYPES[vertical][0].typeLabel;
  const email = cleanEmail(r.email);
  const phone = formatUsPhone(r.phone);
  return {
    sourceKey: `${vertical}:nv:${r.license.toUpperCase()}`,
    name,
    legalName: null,
    city: r.city ? titleCase(r.city) : null,
    state,
    phone,
    licenseId: r.license.toUpperCase(),
    registryName: NV_DOI_REGISTRY,
    typeLabel,
    contactName: null,
    location,
    description: describeRegistryLead({ typeLabel, registryName: NV_DOI_REGISTRY, location, legalName: null, name, listNoun: LIST_NOUN }),
    signalDetail: `NV DOI ${r.licenseType.toLowerCase()} ${r.license}${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email,
    contactSourceUrl: email ? NV_DOI_SOURCE_URL : null,
  };
}

// ---- network ---------------------------------------------------------------

// fetch() does not carry cookies across redirects, and APEX redirects to add its
// session, so the cookie jar is handled by hand.
async function getWithCookies(url: string, jar: Map<string, string>, timeoutMs: number): Promise<Response> {
  let u = url;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(u, {
      headers: { 'User-Agent': DISCOVERY_UA, Accept: '*/*', ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}) },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      u = new URL(res.headers.get('location') as string, u).toString();
      continue;
    }
    return res;
  }
  throw new Error('NV DOI: too many redirects');
}

export function nvDoiPageUrl(licenseType: string): string {
  const qs = new URLSearchParams({ p20_hs: 'Y', p20_type: licenseType, clear: '20' });
  return `${NV_DOI_BASE}?${qs.toString()}`;
}
export const NV_DOI_CSV_URL = `${NV_DOI_BASE}?request=${encodeURIComponent('IR[xlsx]_CSV')}`;

export function parseNvDoiCsv(text: string): NvDoiRow[] {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const header = rows[0]?.map((h) => h.trim());
  if (!header || !header.includes('Email') || !header.includes('Phone') || !header.includes(NV_COL.type)) throw new Error('NV DOI CSV header changed');
  const out: NvDoiRow[] = [];
  for (const raw of rows.slice(1)) {
    if (!raw.some((c) => c.trim())) continue;
    const o: Record<string, string> = {};
    header.forEach((h, i) => { o[h] = (raw[i] ?? '').trim(); });
    out.push(toNvDoiRow(o));
  }
  return out;
}

export async function fetchNvDoiType(licenseType: string, opts: { timeoutMs?: number; log?: (m: string) => void } = {}): Promise<NvDoiRow[]> {
  const t = opts.timeoutMs ?? 120_000;
  const jar = new Map<string, string>();
  const page = await getWithCookies(nvDoiPageUrl(licenseType), jar, t);
  if (!page.ok) throw new Error(`NV DOI report page unavailable (HTTP ${page.status})`);
  await page.arrayBuffer();
  const csv = await getWithCookies(NV_DOI_CSV_URL, jar, t);
  if (!csv.ok) throw new Error(`NV DOI CSV unavailable (HTTP ${csv.status})`);
  if (!/csv/i.test(csv.headers.get('content-type') ?? '')) throw new Error('NV DOI download was not a CSV');
  const rows = parseNvDoiCsv(await csv.text());
  opts.log?.(`nv doi ${licenseType}: ${rows.length} rows`);
  // The report returns only the selected type; a header-only reply means APEX did not keep the session.
  if (!rows.length) throw new Error(`NV DOI returned no rows for ${licenseType}`);
  return rows;
}

const DAY_MS = 86_400_000;

export async function streamNvDoiLeads(
  vertical: NvDoiVertical,
  opts: { now?: Date; isKnown?: (sourceKey: string) => boolean; rows?: NvDoiRow[]; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();
  const all: NvDoiRow[] = opts.rows ?? [];
  if (!opts.rows) for (const t of NV_DOI_TYPES[vertical]) all.push(...(await fetchNvDoiType(t.licenseType, { log: opts.log })));
  for (const r of all) {
    result.scanned++;
    const ev = evaluateNvDoiRow(r, vertical, now);
    if (!ev.keep) { reject(result, ev.reason); continue; }
    const lead = toNvDoiLead(r, vertical, ev);
    if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); continue; }
    result.candidates.push(lead);
  }
  return result;
}

// One fetch per run, then a day-rotating window of `max` leads (same shape as the FL DFS / AR CLB sources).
export async function findNvDoiCandidates(
  vertical: NvDoiVertical,
  max: number,
  opts: { now?: Date; startOverride?: number; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();
  try {
    const all = await streamNvDoiLeads(vertical, { now, isKnown: opts.isKnown, log: opts.log });
    result.scanned = all.scanned;
    result.rejected = all.rejected;
    if (!all.candidates.length) return result;
    const day = Math.floor(now.getTime() / DAY_MS);
    const start = opts.startOverride ?? (day * max) % all.candidates.length;
    for (let i = 0; i < all.candidates.length && result.candidates.length < max; i++) {
      result.candidates.push(all.candidates[(start + i) % all.candidates.length]);
    }
  } catch (e) {
    result.errors.push(`${vertical} nv: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
