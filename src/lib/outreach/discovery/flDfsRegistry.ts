import { CsvRowParser, rowToObject, unwrapCell } from './csvStream';
import { cleanEmail, isFreeMail } from './freightFmcsa';
import { DISCOVERY_UA } from './http';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';

// Insurance and bail-bonds discovery from the Florida Department of Financial
// Services bulk licensee export (the "All Valid Licenses - Business" CSV linked
// from https://licenseesearch.fldfs.com/BulkDownload). No login, no captcha.
//
// This is the only source in the codebase that carries BOTH a published business
// email and a phone for the licensee, so its leads go in contact_status 'found'
// like the FMCSA freight source rather than through website discovery.
//
// Practicalities of the file:
//  * ~26 MB, Latin-1, ~105k rows. It is streamed and parsed row by row; only the
//    rows whose TYCL matches the vertical are ever retained, so memory stays bounded.
//  * NPN / phone / zip / TYCL cells are Excel formula-guarded (`="7410936"`) and
//    are unwrapped by csvStream.unwrapCell.
//  * TYCL 2405 "BAIL BOND AGENCY LICENSE" (572 VALID rows as of 2026-09-24) is the
//    bail-bonds population; TYCL 2105 "AGENCY LICENSE" (~59k VALID rows) is the
//    insurance one. The warranty / title / adjusting / portable-electronics TYCLs
//    are deliberately NOT included: those are not the general-lines agencies we want.

export const FL_DFS_CSV_URL = 'https://www.myfloridacfo.com/downloads/AAS/LicenseeSearch/AllValidLicensesBusiness.csv';
export const FL_DFS_SEARCH_URL = 'https://licenseesearch.fldfs.com/';
const FL_DFS_REGISTRY = 'Florida Department of Financial Services';
const LIST_NOUN = 'licensee file';

export const TYCL_AGENCY = '2105';
export const TYCL_BAIL_BOND = '2405';

export type FlDfsVertical = 'insurance' | 'bailbonds';

const VERTICAL_TYCL: Record<FlDfsVertical, string> = { insurance: TYCL_AGENCY, bailbonds: TYCL_BAIL_BOND };
const TYPE_LABEL: Record<FlDfsVertical, string> = {
  insurance: 'licensed insurance agency',
  bailbonds: 'licensed bail bond agency',
};

export interface FlDfsRow {
  licenseNumber: string;
  name: string;
  npn: string | null;
  tycl: string;
  tyclDesc: string;
  status: string;
  email: string | null;
  phone: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
}

// Column headings in the export (kept verbatim so a heading change fails loudly).
const COL = {
  license: 'License Number',
  name: 'Full Name',
  npn: 'NPN Number',
  tycl: 'License TYCL',
  tyclDesc: 'License TYCL Desc',
  status: 'License Status',
  email: 'Email Address',
  phone: 'Business Phone',
  address1: 'Business Address1',
  city: 'Business City',
  state: 'Business State',
  zip: 'Business Zip',
  county: 'Business County',
} as const;

export function toFlDfsRow(o: Record<string, string>): FlDfsRow {
  const v = (k: string) => (o[k] ?? '').trim() || null;
  return {
    licenseNumber: (o[COL.license] ?? '').trim(),
    name: (o[COL.name] ?? '').trim(),
    npn: v(COL.npn),
    tycl: (o[COL.tycl] ?? '').trim(),
    tyclDesc: (o[COL.tyclDesc] ?? '').trim(),
    status: (o[COL.status] ?? '').trim(),
    email: v(COL.email),
    phone: v(COL.phone),
    address1: v(COL.address1),
    city: v(COL.city),
    state: v(COL.state),
    zip: v(COL.zip),
    county: v(COL.county),
  };
}

export type Evaluation = { keep: true; adjust: number; reasons: string[] } | { keep: false; reason: string };

// Captive/national carriers and the large national brokerages: their Florida
// agency licences are in this file too and they are not the small independent
// agencies we want. (products.ts scoreVocabulary demotes these as well; this is
// a hard skip so we do not spend a lead slot on them.)
const BIG_INSURANCE = /\b(state farm|allstate|farmers insurance|geico|progressive|liberty mutual|nationwide|american family|usaa|travelers|the hartford|aaa\b|marsh|mcLennan|aon\b|gallagher|brown\s*&\s*brown|\busi\b|hub international|acrisure|alliant insurance|nfp corp|lockton|willis towers|risk strategies|goosehead|assurance im|policygenius|esurance|safeco|foremost|citizens property)\b/i;
// Bail-bond networks / franchise-ish national names.
const BIG_BAIL = /\b(aladdin bail|bad boys bail|all ?pro bail|lexington national|american bankers insurance|financial casualty|allegheny casualty|international fidelity)\b/i;

const NAME_JUNK = /\b(warranty|title insurance|adjust(ing|ers?)|premium finance)\b/i;
// Carrier-owned email domains: the surest sign of a captive agent.
const CAPTIVE_DOMAIN = /^(.*\.)?(statefarm|allstate|farmersagency|farmersinsurance|geico|progressive|libertymutual|amfam|amfamagent|nationwide|usaa|thehartford|travelers|goosehead|aaa|aaasouth|shelterinsurance|countryfinancial|americanfamily)\.(com|net|org)$/i;

export function evaluateFlDfsRow(r: FlDfsRow, vertical: FlDfsVertical): Evaluation {
  if (r.tycl !== VERTICAL_TYCL[vertical]) return { keep: false, reason: 'licence type not in scope' };
  if (r.status.toUpperCase() !== 'VALID') return { keep: false, reason: 'licence not valid' };
  if (!r.licenseNumber) return { keep: false, reason: 'no licence number' };
  if (!r.name) return { keep: false, reason: 'no business name' };
  if (r.state && r.state.toUpperCase() !== 'FL') return { keep: false, reason: 'business address not in Florida' };
  if (NAME_JUNK.test(r.name)) return { keep: false, reason: 'warranty/title/adjusting firm' };
  const big = vertical === 'insurance' ? BIG_INSURANCE : BIG_BAIL;
  if (big.test(r.name)) return { keep: false, reason: 'captive/national carrier or large brokerage name' };

  const email = cleanEmail(r.email);
  // A captive agent often licenses the agency under the owner's own name
  // ("Tony Pearson Insurance Agency, Inc.") but uses the carrier's email domain,
  // so the domain catches what the name filter cannot.
  if (email && CAPTIVE_DOMAIN.test(email.split('@')[1] ?? '')) return { keep: false, reason: 'carrier-domain email (captive agent)' };
  const phone = formatUsPhone(r.phone);
  let adjust = 0;
  const reasons: string[] = [];
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };
  if (!email) add(-10, 'no published email in the licensee file');
  else if (isFreeMail(email)) add(-5, 'contact is a free-mail address (no business domain to verify)');
  else add(5, 'business-domain email published in the licensee file');
  if (!phone) add(-5, 'no usable phone in the licensee file');
  return { keep: true, adjust, reasons };
}

export function toFlDfsLead(r: FlDfsRow, vertical: FlDfsVertical, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const name = titleCase(r.name.replace(/\s+/g, ' '));
  const city = r.city ? titleCase(r.city) : null;
  const state = (r.state || 'FL').toUpperCase();
  const location = cityState(r.city, state);
  const typeLabel = TYPE_LABEL[vertical];
  const email = cleanEmail(r.email);
  const phone = formatUsPhone(r.phone);
  return {
    sourceKey: `${vertical}:fl:${r.licenseNumber.toUpperCase()}`,
    name,
    legalName: null,
    city,
    state,
    phone,
    licenseId: r.licenseNumber.toUpperCase(),
    registryName: FL_DFS_REGISTRY,
    typeLabel,
    contactName: null,
    location,
    description: describeRegistryLead({ typeLabel, registryName: FL_DFS_REGISTRY, location, legalName: null, name, listNoun: LIST_NOUN }),
    signalDetail: `FL DFS ${r.tyclDesc.toLowerCase()} ${r.licenseNumber}${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email,
    contactSourceUrl: email ? FL_DFS_SEARCH_URL : null,
  };
}

// ---- network ---------------------------------------------------------------

// The file is ~26 MB, so it is streamed and filtered on the fly: only rows whose
// TYCL matches the vertical are kept. `maxRows` bounds what is retained even
// then (insurance has ~59k matching rows and we only ever ingest a few dozen).
export async function streamFlDfsRows(
  vertical: FlDfsVertical,
  opts: { maxRows?: number; url?: string; timeoutMs?: number; log?: (m: string) => void } = {},
): Promise<{ rows: FlDfsRow[]; scanned: number; matched: number }> {
  const wanted = VERTICAL_TYCL[vertical];
  const maxRows = opts.maxRows ?? 80_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 180_000);
  try {
    const res = await fetch(opts.url ?? FL_DFS_CSV_URL, {
      // The myfloridacfo.com host answers 406 to a narrow Accept header.
      headers: { 'User-Agent': DISCOVERY_UA, Accept: '*/*' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok || !res.body) throw new Error(`FL DFS CSV unavailable (HTTP ${res.status})`);
    // The export is Latin-1, not UTF-8; decoding it as UTF-8 mangles names.
    const decoder = new TextDecoder('latin1');
    const parser = new CsvRowParser();
    let header: string[] | null = null;
    let scanned = 0;
    let matched = 0;
    const rows: FlDfsRow[] = [];
    const take = (raw: string[]) => {
      if (!header) {
        header = raw.map((h) => unwrapCell(h));
        if (!header.includes(COL.tycl) || !header.includes(COL.email)) throw new Error('FL DFS CSV header changed');
        return;
      }
      scanned++;
      // Cheap pre-filter before building an object for 105k rows.
      if (!raw.some((c) => unwrapCell(c) === wanted)) return;
      const r = toFlDfsRow(rowToObject(header, raw));
      if (r.tycl !== wanted) return;
      matched++;
      if (rows.length < maxRows) rows.push(r);
    };
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) for (const raw of parser.feed(decoder.decode(value, { stream: true }))) take(raw);
    }
    const last = parser.end();
    if (last) take(last);
    if (!header) throw new Error('FL DFS CSV was empty');
    if (matched < 50) throw new Error(`FL DFS CSV yielded only ${matched} ${vertical} rows; file layout may have changed`);
    opts.log?.(`fl dfs ${vertical}: scanned ${scanned}, matched ${matched}`);
    return { rows, scanned, matched };
  } finally {
    clearTimeout(timer);
  }
}

const DAY_MS = 86_400_000;

// One pass over the file per run, then a day-rotating walk of the matching rows
// that skips leads we already hold. The rotation is what caps ingestion: the
// insurance population is ~59k rows and a run only ever takes `max` of them, at
// a different offset each day, so the list is worked through gradually instead
// of being inserted in one go.
export async function findFlDfsCandidates(
  vertical: FlDfsVertical,
  max: number,
  opts: { now?: Date; startOverride?: number; isKnown?: (sourceKey: string) => boolean; rowsOverride?: FlDfsRow[]; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();
  try {
    const rows = opts.rowsOverride ?? (await streamFlDfsRows(vertical, { log: opts.log })).rows;
    result.scanned = rows.length;
    if (!rows.length) throw new Error('no rows returned');
    const day = Math.floor(now.getTime() / DAY_MS);
    const start = opts.startOverride ?? (day * max) % rows.length;
    for (let i = 0; i < rows.length && result.candidates.length < max; i++) {
      const r = rows[(start + i) % rows.length];
      if (opts.isKnown?.(`${vertical}:fl:${r.licenseNumber.toUpperCase()}`)) { reject(result, 'already known'); continue; }
      const ev = evaluateFlDfsRow(r, vertical);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      result.candidates.push(toFlDfsLead(r, vertical, ev));
    }
  } catch (e) {
    result.errors.push(`fl dfs ${vertical}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
