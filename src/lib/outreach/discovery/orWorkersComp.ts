import { socrataGet } from './socrata';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, splitDba, type RegistryLead, type RegistryResult } from './registryCommon';

// Cross-vertical discovery from the Oregon Department of Consumer and Business
// Services "Oregon Active Workers' Compensation Employer Database" (Socrata
// q9zj-c8r2 on data.oregon.gov): every Oregon employer with workers'
// compensation coverage on file, with legal business name, principal place of
// business, NAICS class, headcount band, insurer and a PHONE number.
//
// Unlike the Texas DWC file (txWorkersComp.ts) this one carries a phone, so
// leads are phone-callable straight away. There is still no email, so
// stageEnrich resolves the website/email as for the other phone-only registries.
//
// Verified 2026-09-30: 131,357 rows, 131,036 with insurer_status '1' (active),
// 90.4% with a 10-digit phone (area code + number are separate columns),
// freshest insurer_status_date 2026-09-08. Active-row counts by NAICS in the
// verticals Calldesk sells to: 524210 insurance 1,705; 238220 plumbing/HVAC
// 1,598; 238210 electrical 1,427; 621210 dental 1,362; 624410 child care 1,004;
// 721110 hotels 947; 541211 CPA 722; 238160 roofing 684; 531210 real estate 623;
// 541940 vets 516; 621340 physio 400; 488410 towing 105; 812210 funeral 95;
// 562991 septic 68; 485310/485320 taxi+limo 38.
//
// This is NOT a trade licence: the description says only that the employer is on
// the state workers' compensation file in a NAICS class. Open data, no login.

export const OR_WC_HOST = 'data.oregon.gov';
export const OR_WC_DATASET = 'q9zj-c8r2';
export const OR_WC_REGISTRY = 'Oregon Department of Consumer and Business Services, Workers’ Compensation Division';
export const OR_WC_SOURCE_URL = 'https://data.oregon.gov/d/q9zj-c8r2';
const LIST_NOUN = 'workers’ compensation employer database';

export interface OrNaicsClass {
  code: string;
  label: string; // NAICS class wording used in the description
}

export const OR_NAICS: Record<string, OrNaicsClass[]> = {
  homeservices: [
    { code: '238220', label: 'plumbing, heating and air-conditioning contractors' },
    { code: '238210', label: 'electrical contractors and other wiring installation contractors' },
    { code: '238160', label: 'roofing contractors' },
  ],
  insurance: [{ code: '524210', label: 'insurance agencies and brokerages' }],
  dental: [{ code: '621210', label: 'offices of dentists' }],
  childcare: [{ code: '624410', label: 'child care services' }],
  accounting: [{ code: '541211', label: 'offices of certified public accountants' }],
  realestate: [{ code: '531210', label: 'offices of real estate agents and brokers' }],
  vets: [{ code: '541940', label: 'veterinary services' }],
  physio: [{ code: '621340', label: 'offices of physical, occupational and speech therapists and audiologists' }],
  funeral: [{ code: '812210', label: 'funeral homes and funeral services' }],
  towing: [{ code: '488410', label: 'motor vehicle towing' }],
  septic: [{ code: '562991', label: 'septic tank and related services' }],
  taxi: [
    { code: '485310', label: 'taxi and ridesharing services' },
    { code: '485320', label: 'limousine service' },
  ],
  lodging: [
    { code: '721110', label: 'hotels (except casino hotels) and motels' },
    { code: '721199', label: 'all other traveler accommodation' },
  ],
  homecare: [{ code: '621610', label: 'home health care services' }],
};

export function orSupportsVertical(productId: string): boolean {
  return !!OR_NAICS[productId];
}

export interface OrEmployerRow {
  employer_num?: string;
  legal_business_name?: string;
  naics?: string;
  employees_range?: string;
  ppb_address2?: string;
  ppb_city?: string;
  ppb_state?: string;
  ppb_zip?: string;
  insurer_status?: string;
  insurer_status_date?: string;
  liad_end_date?: string;
  phone_area?: string;
  phone?: string;
}

export type Evaluation = { keep: true; adjust: number; reasons: string[] } | { keep: false; reason: string };

const PEO = /\b(staffing|staff leasing|employee leasing|\bpeo\b|personnel|temporaries|labor ready|payroll|administrative services)\b/i;
const INSTITUTIONAL = /\b(hospital|health system|medical center|university|college|school district|county of|city of|state of oregon|providence|legacy health|kaiser|oregon health (&|and) science|\bohsu\b|samaritan)\b/i;
const NATIONAL = /\b(aspen dental|heartland dental|pacific dental|smile brands|western dental|affordable dentures|roto[- ]?rooter|mr\.? rooter|benjamin franklin plumbing|one hour heating|aire serv|ars\/?rescue rooter|service experts|home depot|lowe'?s|state farm|allstate|farmers insurance|geico|progressive|liberty mutual|nationwide|american family|usaa|brown\s*&\s*brown|gallagher|hub international|acrisure|goosehead|kindercare|bright horizons|primrose|goddard school|\bymca\b|boys (and|&) girls club|banfield|vca |petco|amedisys|encompass health|enhabit|gentiva|bayada|marriott|hilton|hyatt|best western|motel 6|holiday inn|comfort inn|super 8|choice hotels|wyndham|dignity memorial|service corporation|\bsci\b|h&r block|jackson hewitt|re\/max|keller williams|coldwell banker|century 21|compass real estate)\b/i;

// "2026-03-29T00:00:00.000" -> Date (UTC); null if unparsable.
export function parseOrDate(raw: string | null | undefined): Date | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const d = new Date(s.endsWith('Z') ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// The area code and the 7-digit number are separate columns.
export function orPhone(r: Pick<OrEmployerRow, 'phone_area' | 'phone'>): string | null {
  return formatUsPhone(`${(r.phone_area ?? '').trim()}${(r.phone ?? '').trim()}`);
}

export function evaluateOrEmployerRow(r: OrEmployerRow, now = new Date()): Evaluation {
  const name = (r.legal_business_name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { keep: false, reason: 'no employer name' };
  if ((r.insurer_status ?? '') !== '1') return { keep: false, reason: 'coverage not active' };
  const end = parseOrDate(r.liad_end_date);
  if (end && end.getTime() < now.getTime()) return { keep: false, reason: 'policy expired' };
  if (PEO.test(name)) return { keep: false, reason: 'staffing agency, PEO or payroll company' };
  if (INSTITUTIONAL.test(name)) return { keep: false, reason: 'hospital, institution or government employer' };
  if (NATIONAL.test(name)) return { keep: false, reason: 'national chain or franchise name' };
  const band = (r.employees_range ?? '').trim();
  if (band === '100-499' || band === '500 or more' || band === '50-99') return { keep: false, reason: 'employer headcount band 50+ (not a small business)' };
  const phone = orPhone(r);
  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };
  add(-3, 'no email in the employer file (website discovery needed)');
  if (!phone) add(-5, 'no usable phone in the employer file');
  else add(2, 'phone published in the employer file');
  if (band === '1-10') add(2, 'headcount band 1-10 (owner-run)');
  if (!(r.ppb_city ?? '').trim()) add(-5, 'no city in the employer record');
  return { keep: true, adjust, reasons };
}

// No licence number in the file: the key is the state's employer number, which is
// stable across refreshes.
export function orSourceKey(productId: string, r: OrEmployerRow): string {
  return `${productId}:or:${(r.employer_num ?? '').trim()}`;
}

export function toOrEmployerLead(productId: string, cls: OrNaicsClass, r: OrEmployerRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const { legal, dba } = splitDba((r.legal_business_name as string).replace(/\s+/g, ' ').trim());
  const name = titleCase(dba ?? legal);
  const legalName = dba ? titleCase(legal) : null;
  const city = r.ppb_city?.trim() || null;
  const state = (r.ppb_state?.trim() || 'OR').toUpperCase();
  const location = cityState(city, state);
  const phone = orPhone(r);
  const typeLabel = `business with active workers’ compensation coverage in the "${cls.label}" NAICS class`;
  return {
    sourceKey: orSourceKey(productId, r),
    name,
    legalName,
    city: city ? titleCase(city) : null,
    state,
    phone,
    licenseId: (r.employer_num ?? '').trim(),
    registryName: OR_WC_REGISTRY,
    typeLabel,
    contactName: null,
    location,
    description: describeRegistryLead({ typeLabel, registryName: OR_WC_REGISTRY, location, legalName, name, listNoun: LIST_NOUN }),
    signalDetail: `OR WCD employer ${r.employer_num}, NAICS ${cls.code} (${cls.label})${r.employees_range ? `; headcount ${r.employees_range}` : ''}${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
  };
}

// ---- network ---------------------------------------------------------------

const SELECT = 'employer_num,legal_business_name,naics,employees_range,ppb_address2,ppb_city,ppb_state,ppb_zip,insurer_status,insurer_status_date,liad_end_date,phone_area,phone';
const PAGE = 1000;
const DAY_MS = 86_400_000;

function whereFor(code: string, now: Date): string {
  return `naics='${code}' AND insurer_status='1' AND liad_end_date>'${now.toISOString().slice(0, 10)}'`;
}

export async function countOrEmployers(code: string, now = new Date(), log: (m: string) => void = () => {}): Promise<number> {
  const rows = await socrataGet<{ count: string }>(OR_WC_HOST, OR_WC_DATASET, { $select: 'count(*)', $where: whereFor(code, now) }, log);
  return Number(rows[0]?.count) || 0;
}

export async function fetchOrEmployers(code: string, offset: number, limit = PAGE, now = new Date(), log: (m: string) => void = () => {}): Promise<OrEmployerRow[]> {
  return socrataGet<OrEmployerRow>(OR_WC_HOST, OR_WC_DATASET, {
    $where: whereFor(code, now),
    $order: 'employer_num',
    $limit: String(limit),
    $offset: String(offset),
    $select: SELECT,
  }, log);
}

export function orClassForDay(productId: string, day: number): OrNaicsClass | null {
  const list = OR_NAICS[productId];
  if (!list?.length) return null;
  return list[((day % list.length) + list.length) % list.length];
}

// Server-side filtered, one day-rotating page per run (same shape as the TX DWC source).
export async function findOrEmployerCandidates(
  productId: string,
  max: number,
  opts: { now?: Date; naics?: string; offsetOverride?: number; pageSize?: number; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const result = emptyResult();
  const day = Math.floor(now.getTime() / DAY_MS);
  const cls = opts.naics ? (OR_NAICS[productId] ?? []).find((c) => c.code === opts.naics) ?? null : orClassForDay(productId, day);
  if (!cls) {
    result.errors.push(`or wc: no NAICS class for ${productId}`);
    return result;
  }
  try {
    const total = await countOrEmployers(cls.code, now, log);
    if (total <= 0) throw new Error(`no active employers for NAICS ${cls.code}`);
    const page = opts.pageSize ?? PAGE;
    const offset = opts.offsetOverride ?? (day * page) % Math.max(1, total);
    const rows = await fetchOrEmployers(cls.code, offset, page, now, log);
    result.scanned = rows.length;
    for (const r of rows) {
      if (result.candidates.length >= max) break;
      const key = orSourceKey(productId, r);
      if (opts.isKnown?.(key)) { reject(result, 'already known'); continue; }
      const ev = evaluateOrEmployerRow(r, now);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      result.candidates.push(toOrEmployerLead(productId, cls, r, ev));
    }
  } catch (e) {
    result.errors.push(`${productId} or: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
