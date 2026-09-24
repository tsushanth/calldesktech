import { streamDelimitedRows } from './delimitedStream';
import { DISCOVERY_UA } from './http';
import {
  cityCountry, emptyResult, formatIntlPhone, reject, titleCase, type RegistryLead, type RegistryResult,
} from './registryCommon';

// Dental and home-care discovery from the CARE QUALITY COMMISSION directory of
// registered locations in England — the statutory register of every regulated
// health and social care service. One public CSV, no key (verified 2026-09-24:
// 57,139 locations).
//
// EVERY lead from here is stored ON HOLD (region_blocked + signals.intlHold);
// see registryCommon.INTL_HOLD_REASON.
//
// What the file gives us, and does not:
//  * a phone number on essentially every row, and a website on ~4,600 of the
//    12,068 dentists and ~7,400 of the 13,900 home-care locations;
//  * NO email at all. So these leads go in contact_status 'unknown' and need the
//    existing website -> published-email discovery step, which only runs once the
//    country has been released (stageEnrich skips region-blocked leads).
//
// PECR RISK, and the filter it forces. UK direct marketing by email to an
// individual or a sole trader (including a partnership that is not an LLP) needs
// consent; to a corporate subscriber it does not. A large share of CQC dental
// providers are individual dentists or partnerships trading under their own name.
// So only providers whose name carries a CORPORATE legal form are kept — see
// isUkCorporateName. That throws away real businesses, deliberately: the ones
// kept are the ones we can lawfully email.

export const CQC_FALLBACK_CSV_URL = 'https://www.cqc.org.uk/system/files/2026-09/23_september_2026_CQC_directory.csv';
export const CQC_DATA_PAGE_URL = 'https://www.cqc.org.uk/about-us/transparency/using-cqc-data';
export const CQC_REGISTRY = 'Care Quality Commission';
const LIST_NOUN = 'directory of registered locations';

export type CqcVertical = 'dental' | 'homecare';

// Column headings, verbatim, from the 5th line of the file (the first four lines
// are a title block). A heading change must fail loudly, not silently empty out.
export const CQC_COL = {
  name: 'Name',
  alsoKnownAs: 'Also known as',
  address: 'Address',
  postcode: 'Postcode',
  phone: 'Phone number',
  website: "Service's website (if available)",
  serviceTypes: 'Service types',
  latestCheck: 'Date of latest check',
  specialisms: 'Specialisms/services',
  provider: 'Provider name',
  localAuthority: 'Local authority',
  region: 'Region',
  locationUrl: 'Location URL',
  locationId: 'CQC Location ID (for office use only)',
  providerId: 'CQC Provider ID (for office use only)',
} as const;

export const CQC_REQUIRED_COLUMNS = [CQC_COL.name, CQC_COL.serviceTypes, CQC_COL.provider, CQC_COL.locationId];

export interface CqcRow {
  name: string;
  alsoKnownAs: string | null;
  address: string | null;
  postcode: string | null;
  phone: string | null;
  website: string | null;
  serviceTypes: string[];
  provider: string;
  localAuthority: string | null;
  region: string | null;
  locationUrl: string | null;
  locationId: string;
}

export function toCqcRow(o: Record<string, string>): CqcRow {
  const v = (k: string) => (o[k] ?? '').trim() || null;
  return {
    name: (o[CQC_COL.name] ?? '').trim().replace(/\s+/g, ' '),
    alsoKnownAs: v(CQC_COL.alsoKnownAs),
    address: v(CQC_COL.address),
    postcode: v(CQC_COL.postcode),
    phone: v(CQC_COL.phone),
    website: v(CQC_COL.website),
    // "Homecare agencies|Supported living" -> ['Homecare agencies','Supported living'].
    serviceTypes: (o[CQC_COL.serviceTypes] ?? '').split('|').map((s) => s.trim()).filter(Boolean),
    provider: (o[CQC_COL.provider] ?? '').trim().replace(/\s+/g, ' '),
    localAuthority: v(CQC_COL.localAuthority),
    region: v(CQC_COL.region),
    locationUrl: v(CQC_COL.locationUrl),
    locationId: (o[CQC_COL.locationId] ?? '').trim(),
  };
}

// The Service types values that define each vertical (2026-09-24 counts across
// the file, counting a location once even when it lists several types):
// 'Dentist' 12,068; 'Homecare agencies' 13,900-ish across its combinations.
const VERTICAL_SERVICE_TYPE: Record<CqcVertical, RegExp> = {
  dental: /^dentist$/i,
  homecare: /^homecare agencies$/i,
};

const TYPE_LABEL: Record<CqcVertical, string> = {
  dental: 'registered dental practice',
  homecare: 'registered domiciliary (home) care agency',
};

// A corporate subscriber for PECR purposes. LLP and CIC are included (an LLP is a
// body corporate; a CIC is a company); an ordinary partnership and a sole trader
// are NOT, which is the whole point of the filter.
const CORPORATE_FORM = /(\bltd\b|\blimited\b|\bplc\b|\bp\.l\.c\b|\bllp\b|\bl\.l\.p\b|\bcic\b|\bc\.i\.c\b|community interest company|\bcio\b|charitable incorporated|\bltd\.|\bco\.? ?ltd\b|\bunlimited\b)/i;
// Explicitly NOT corporate however the name is written.
const NON_CORPORATE_FORM = /(\bpartnership\b|\bthe partners\b|\bsole trader\b|\bt\/a\b|\bdr\b|\bdrs\b|\bmr\b|\bmrs\b|\bms\b|\bmiss\b|\bmessrs\b)/i;

export function isUkCorporateName(name: string): boolean {
  const n = (name ?? '').trim();
  if (!n) return false;
  if (!CORPORATE_FORM.test(n)) return false;
  // "Dr A Patel Ltd" is a company, so a corporate form wins over a title — but a
  // bare "The Partners of X" or "Mr A Smith" without one does not get through.
  return true;
}

// NHS trusts, councils and the national chains: public bodies we do not cold-email
// and groups too big to be the target.
const BIG_UK = /\b(nhs\b|national health service|university hospital|foundation trust|\bcouncil\b|county borough|borough of|ministry of|\bmod\b|hm prison|\bhmp\b|bupa|mydentist|\bidh\b|integrated dental|portman|dentex|rodericks|colosseum dental|dentalcare group|\bbdg\b|southern dental|clyde munro|genesis dental|sk:?n\b|specsavers|boots\b|superdrug|four seasons health|\bhc[- ]one\b|barchester|care ?uk\b|anchor\b|sanctuary care|bluebird care|home ?instead|helping hands|right at home|caremark|radfield|city ?& ?county|mears\b|allied healthcare|cera care|agincare|prestige nursing|newcross|sonderwell)\b/i;

export type Evaluation =
  | { keep: true; adjust: number; reasons: string[] }
  | { keep: false; reason: string };

// Address is "7-9 White Kennet Street,London" — the town is the last
// comma-separated part. (Some rows have only a street, in which case the local
// authority is the best available place name.)
export function cqcTown(row: CqcRow): string | null {
  const parts = (row.address ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const last = parts.length > 1 ? parts[parts.length - 1] : null;
  return last || row.localAuthority || null;
}

export function evaluateCqcRow(row: CqcRow, vertical: CqcVertical): Evaluation {
  if (!row.name) return { keep: false, reason: 'no location name' };
  if (!row.locationId) return { keep: false, reason: 'no CQC location id' };
  if (!row.provider) return { keep: false, reason: 'no provider name' };
  const want = VERTICAL_SERVICE_TYPE[vertical];
  if (!row.serviceTypes.some((t) => want.test(t))) return { keep: false, reason: `service type is not ${vertical}` };
  if (BIG_UK.test(row.provider) || BIG_UK.test(row.name)) return { keep: false, reason: 'NHS body, local authority or national chain' };
  // The PECR gate.
  if (!isUkCorporateName(row.provider)) {
    return {
      keep: false,
      reason: NON_CORPORATE_FORM.test(row.provider)
        ? 'provider is an individual, sole trader or partnership (PECR consent required)'
        : 'provider name carries no corporate legal form (PECR consent required)',
    };
  }

  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };

  add(3, 'registered with the Care Quality Commission');
  add(2, 'provider is a corporate body (Ltd/PLC/LLP/CIC), so B2B email is permitted under PECR');
  if (row.website) add(5, 'publishes its own website in the CQC directory');
  if (formatIntlPhone(row.phone)) add(2, 'publishes a phone number in the CQC directory');
  // A provider running several locations is a small group rather than a single
  // practice; still wanted, but a single site is the better fit.
  if (row.serviceTypes.length > 2) add(-3, 'registered for several different service types (a mixed group, not a single practice)');

  return { keep: true, adjust, reasons };
}

// "https://www.example.co.uk/x" -> "example.co.uk"; null if unusable.
export function cqcDomain(raw: string | null): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    return h.includes('.') ? h : null;
  } catch {
    return null;
  }
}

export function cqcSourceKey(vertical: CqcVertical, locationId: string): string {
  return `${vertical}:gb-cqc:${locationId.toUpperCase()}`;
}

export function toCqcLead(row: CqcRow, vertical: CqcVertical, ev: Extract<Evaluation, { keep: true }>): RegistryLead {
  const name = titleCase(row.name);
  const town = cqcTown(row);
  const location = cityCountry(town, 'GB');
  const phone = formatIntlPhone(row.phone);
  const typeLabel = TYPE_LABEL[vertical];
  let description = `Listed in the Care Quality Commission ${LIST_NOUN} as a ${typeLabel}`;
  if (location) description += `, based in ${location}`;
  return {
    sourceKey: cqcSourceKey(vertical, row.locationId),
    name,
    legalName: row.provider && row.provider.toLowerCase() !== row.name.toLowerCase() ? row.provider : null,
    city: town ? titleCase(town) : null,
    state: 'GB',
    phone,
    licenseId: row.locationId,
    registryName: CQC_REGISTRY,
    typeLabel,
    contactName: null,
    location,
    description: `${description}.`,
    signalDetail: `CQC location ${row.locationId} (${row.serviceTypes.join(', ')}), provider ${row.provider}${phone ? `; register phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    // The directory has no email column at all; the website it does publish is
    // handed straight to the existing website -> published-email step, saving it
    // an LLM search once the country is released.
    email: null,
    domain: cqcDomain(row.website),
    contactSourceUrl: row.locationUrl,
    country: 'GB',
  };
}

// ---- network ---------------------------------------------------------------

// The file's URL carries the month it was produced, so the current one is
// resolved from the CQC transparency page and the pinned URL is only a fallback.
export async function resolveCqcCsvUrl(opts: { timeoutMs?: number; log?: (m: string) => void } = {}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(CQC_DATA_PAGE_URL, { headers: { 'User-Agent': DISCOVERY_UA, Accept: 'text/html' }, signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const found = [...html.matchAll(/https:\/\/[^"'\s>]*?CQC_directory[^"'\s>]*?\.csv/gi)].map((m) => m[0]);
    if (found.length) {
      // Newest first: the path contains a YYYY-MM folder.
      found.sort().reverse();
      opts.log?.(`cqc: resolved ${found[0]}`);
      return found[0];
    }
    throw new Error('no CQC_directory CSV link on the page');
  } catch (e) {
    opts.log?.(`cqc: falling back to the pinned CSV URL (${e instanceof Error ? e.message : String(e)})`);
    return CQC_FALLBACK_CSV_URL;
  } finally {
    clearTimeout(timer);
  }
}

export interface CqcOpts {
  now?: Date;
  isKnown?: (sourceKey: string) => boolean;
  log?: (m: string) => void;
  url?: string;
  timeoutMs?: number;
  rowsOverride?: CqcRow[];
}

export async function findCqcCandidates(vertical: CqcVertical, max: number, opts: CqcOpts = {}): Promise<RegistryResult> {
  const result = emptyResult();
  const seen = new Set<string>();
  const take = (row: CqcRow): boolean => {
    const key = cqcSourceKey(vertical, row.locationId);
    if (seen.has(key)) { reject(result, 'duplicate location id'); return true; }
    if (opts.isKnown?.(key)) { seen.add(key); reject(result, 'already known'); return true; }
    const ev = evaluateCqcRow(row, vertical);
    if (!ev.keep) { reject(result, ev.reason); return true; }
    seen.add(key);
    result.candidates.push(toCqcLead(row, vertical, ev));
    return result.candidates.length < max;
  };
  try {
    if (opts.rowsOverride) {
      result.scanned = opts.rowsOverride.length;
      for (const row of opts.rowsOverride) if (!take(row)) break;
    } else {
      const url = opts.url ?? (await resolveCqcCsvUrl({ log: opts.log }));
      const { scanned } = await streamDelimitedRows({
        url,
        delimiter: 'comma',
        requiredColumns: CQC_REQUIRED_COLUMNS,
        minRows: 10_000,
        timeoutMs: opts.timeoutMs ?? 240_000,
        log: opts.log,
        onRow: (o) => take(toCqcRow(o)),
      });
      result.scanned = scanned;
    }
    opts.log?.(`uk cqc ${vertical}: scanned ${result.scanned}, candidates ${result.candidates.length}`);
  } catch (e) {
    result.errors.push(`uk cqc ${vertical}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

export function allCqcLeads(vertical: CqcVertical, opts: CqcOpts = {}): Promise<RegistryResult> {
  return findCqcCandidates(vertical, Number.MAX_SAFE_INTEGER, opts);
}
