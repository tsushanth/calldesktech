import { socrataGet } from './socrata';
import { titleCase, cityState, describeRegistryLead, emptyResult, reject, splitDba, type RegistryLead, type RegistryResult } from './registryCommon';

// Cross-vertical discovery from the Texas Department of Insurance, Division of
// Workers' Compensation subscriber report ("Workers' compensation insurance
// coverage subscriber information", Socrata c4xz-httr on data.texas.gov). Every
// Texas employer with an active workers' compensation policy, with the employer's
// name, address and NAICS class.
//
// This is NOT a trade or professional licence, so the lead description says only
// what the file supports: an employer with active Texas workers' compensation
// coverage in a given NAICS class. There is no phone and no email in the data at
// all, so every lead goes through the normal website/email discovery — the same
// shape as the WA L&I and Missouri sources.
//
// Active policy counts by NAICS (policy_expiration_date in the future, verified
// 2026-09-24): 621210 dental 9,045; 238220 plumbing/HVAC 6,551; 524210 insurance
// 5,847; 238210 electrical 5,287; 621610 home care 2,753; 238160 roofing 1,798;
// 488410 towing 379; 562991 septic 235.

export const TX_DWC_HOST = 'data.texas.gov';
export const TX_DWC_DATASET = 'c4xz-httr';
export const TX_DWC_REGISTRY = "Texas Department of Insurance, Division of Workers' Compensation";
export const TX_DWC_SOURCE_URL = 'https://data.texas.gov/dataset/Workers-compensation-insurance-coverage-subscriber-/c4xz-httr';
const LIST_NOUN = 'workers’ compensation subscriber file';

// NAICS classes, in the words the NAICS manual uses for them, grouped by the
// product vertical they feed.
export interface TxNaicsClass {
  code: string;
  label: string; // NAICS class wording used in the description
}

export const TX_NAICS: Record<string, TxNaicsClass[]> = {
  dental: [{ code: '621210', label: 'offices of dentists' }],
  homeservices: [
    { code: '238220', label: 'plumbing, heating and air-conditioning contractors' },
    { code: '238210', label: 'electrical contractors and other wiring installation contractors' },
    { code: '238160', label: 'roofing contractors' },
  ],
  insurance: [{ code: '524210', label: 'insurance agencies and brokerages' }],
  homecare: [{ code: '621610', label: 'home health care services' }],
  towing: [{ code: '488410', label: 'motor vehicle towing' }],
  septic: [{ code: '562991', label: 'septic tank and related services' }],
};

export function txSupportsVertical(productId: string): boolean {
  return !!TX_NAICS[productId];
}

export interface TxEmployerRow {
  insured_employer_name?: string;
  insured_employer_address?: string;
  insured_employer_address_1?: string;
  insured_employer_city?: string;
  insured_employer_state?: string;
  insured_employer_zip?: string;
  sic_code_naics_code?: string;
  governing_class_code?: string;
  policy_effective_date?: string;
  policy_expiration_date?: string;
  coverage_provider_name?: string;
  record_type?: string;
}

export type Evaluation = { keep: true; adjust: number; reasons: string[] } | { keep: false; reason: string };

// Staffing agencies, PEOs and payroll companies carry coverage under a client's
// NAICS class; they are not the business we want to phone.
const PEO = /\b(staffing|staff leasing|employee leasing|\bpeo\b|personnel|temporaries|labor ready|payroll|administrative services)\b/i;
// Hospital/university/government employers and the national chains across all
// the verticals this source feeds.
const INSTITUTIONAL = /\b(hospital|health system|medical center|university|college|school district|\bisd\b|county of|city of|state of texas|independent school|methodist|baptist health|\bhca\b|tenet|ascension|christus|memorial hermann|texas health|\bva\b medical|kaiser)\b/i;
const NATIONAL = /\b(aspen dental|heartland dental|pacific dental|smile brands|western dental|affordable dentures|roto[- ]?rooter|mr\.? rooter|benjamin franklin plumbing|one hour heating|aire serv|ars\/?rescue rooter|service experts|abc home ?&? ?commercial|home depot|lowe'?s|state farm|allstate|farmers insurance|geico|progressive|liberty mutual|nationwide|american family|usaa|brown\s*&\s*brown|gallagher|hub international|acrisure|goosehead|amedisys|encompass health|enhabit|gentiva|accentcare|bayada|brookdale|copart|\bnsd\b|united road)\b/i;

export function parseTxDate(raw: string | null | undefined): Date | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const d = new Date(s.endsWith('Z') ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function evaluateTxEmployerRow(r: TxEmployerRow, now = new Date()): Evaluation {
  const name = (r.insured_employer_name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { keep: false, reason: 'no employer name' };
  const exp = parseTxDate(r.policy_expiration_date);
  if (!exp || exp.getTime() < now.getTime()) return { keep: false, reason: 'policy expired' };
  if (PEO.test(name)) return { keep: false, reason: 'staffing agency, PEO or payroll company' };
  if (INSTITUTIONAL.test(name)) return { keep: false, reason: 'hospital, institution or government employer' };
  if (NATIONAL.test(name)) return { keep: false, reason: 'national chain or franchise name' };
  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };
  // The file has no contact detail whatsoever, so every lead needs website
  // discovery before it can be mailed; that is worth being honest about in the
  // score the same way the other phone-less sources are.
  add(-5, 'no phone or email in the subscriber file');
  if (!(r.insured_employer_city ?? '').trim()) add(-5, 'no city in the subscriber record (harder to resolve a website)');
  return { keep: true, adjust, reasons };
}

// The subscriber file has no licence number, so the key is the NAICS class plus
// a slug of the employer name and zip — stable across quarterly refreshes.
export function txSourceKey(productId: string, r: TxEmployerRow): string {
  const slug = (r.insured_employer_name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40);
  const zip = (r.insured_employer_zip ?? '').replace(/\D/g, '').slice(0, 5);
  return `${productId}:tx:${slug}-${zip}`;
}

export function toTxEmployerLead(productId: string, cls: TxNaicsClass, r: TxEmployerRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const { legal, dba } = splitDba((r.insured_employer_name as string).replace(/\s+/g, ' ').trim());
  const name = titleCase(dba ?? legal);
  const legalName = dba ? titleCase(legal) : null;
  const city = r.insured_employer_city?.trim() || null;
  const state = (r.insured_employer_state?.trim() || 'TX').toUpperCase();
  const location = cityState(city, state);
  const typeLabel = `employer with active workers’ compensation coverage in the "${cls.label}" class`;
  return {
    sourceKey: txSourceKey(productId, r),
    name,
    legalName,
    city: city ? titleCase(city) : null,
    state,
    phone: null,
    licenseId: cls.code,
    registryName: TX_DWC_REGISTRY,
    typeLabel,
    contactName: null,
    location,
    description: describeRegistryLead({ typeLabel, registryName: TX_DWC_REGISTRY, location, legalName, name, listNoun: LIST_NOUN }),
    signalDetail: `TX DWC workers' compensation subscriber, NAICS ${cls.code} (${cls.label})${r.policy_expiration_date ? `; policy to ${r.policy_expiration_date.slice(0, 10)}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
  };
}

// ---- network ---------------------------------------------------------------

const SELECT = 'insured_employer_name,insured_employer_address,insured_employer_city,insured_employer_state,insured_employer_zip,sic_code_naics_code,governing_class_code,policy_effective_date,policy_expiration_date,coverage_provider_name';
const PAGE = 400;
const DAY_MS = 86_400_000;

function whereFor(code: string, now: Date): string {
  return `sic_code_naics_code='${code}' AND policy_expiration_date>'${now.toISOString().slice(0, 10)}'`;
}

export async function countTxEmployers(code: string, now = new Date(), log: (m: string) => void = () => {}): Promise<number> {
  const rows = await socrataGet<{ count: string }>(TX_DWC_HOST, TX_DWC_DATASET, { $select: 'count(*)', $where: whereFor(code, now) }, log);
  return Number(rows[0]?.count) || 0;
}

export async function fetchTxEmployers(code: string, offset: number, now = new Date(), log: (m: string) => void = () => {}): Promise<TxEmployerRow[]> {
  return socrataGet<TxEmployerRow>(TX_DWC_HOST, TX_DWC_DATASET, {
    $where: whereFor(code, now),
    $order: 'insured_employer_name',
    $limit: String(PAGE),
    $offset: String(offset),
    $select: SELECT,
  }, log);
}

// Which NAICS class a vertical uses on a given day (homeservices has three).
export function txClassForDay(productId: string, day: number): TxNaicsClass | null {
  const list = TX_NAICS[productId];
  if (!list?.length) return null;
  return list[((day % list.length) + list.length) % list.length];
}

// Server-side filtered, one day-rotating page per run: the same shape as the WA
// L&I source, so OUTREACH_REGISTRY_MAX_PER_RUN still caps what a run ingests.
export async function findTxEmployerCandidates(
  productId: string,
  max: number,
  opts: { now?: Date; naics?: string; offsetOverride?: number; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const result = emptyResult();
  const day = Math.floor(now.getTime() / DAY_MS);
  const cls = opts.naics
    ? (TX_NAICS[productId] ?? []).find((c) => c.code === opts.naics) ?? null
    : txClassForDay(productId, day);
  if (!cls) {
    result.errors.push(`tx dwc: no NAICS class for ${productId}`);
    return result;
  }
  try {
    const total = await countTxEmployers(cls.code, now, log);
    if (total <= 0) throw new Error(`no active policies for NAICS ${cls.code}`);
    const offset = opts.offsetOverride ?? (day * PAGE) % Math.max(1, total);
    const rows = await fetchTxEmployers(cls.code, offset, now, log);
    result.scanned = rows.length;
    for (const r of rows) {
      if (result.candidates.length >= max) break;
      const key = txSourceKey(productId, r);
      if (opts.isKnown?.(key)) { reject(result, 'already known'); continue; }
      const ev = evaluateTxEmployerRow(r, now);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      result.candidates.push(toTxEmployerLead(productId, cls, r, ev));
    }
  } catch (e) {
    result.errors.push(`${productId} tx: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
