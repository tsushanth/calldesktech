import { socrataGet } from './socrata';
import { cleanEmail, isFreeMail } from './freightFmcsa';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, splitDba, type RegistryLead, type RegistryResult } from './registryCommon';

// Home-services discovery from the New York City Department of Buildings
// "License Info" dataset (Socrata t8hj-ruu2 on data.cityofnewyork.us). One row
// per licence, with the licensee's own business name, address, phone and — for
// most active licences — a business email.
//
// Only two licence types are used:
//   MASTER PLUMBER  1,137 ACTIVE rows, 1,110 with a business_email
//   ELECTRICAL FIRM 1,134 ACTIVE rows, 1,116 with a business_email
// (verified 2026-09-24; the dataset's 3,007 / 5,544 totals include EXPIRED,
// SURRENDERED, DECEASED and RETIRED rows, which are all rejected here).
//
// GENERAL CONTRACTOR (9,749 active, 7,342 with email) is deliberately NOT used:
// the dataset has no field distinguishing a home-improvement contractor from a
// commercial builder or developer, so there is no way to tell from the record
// that a lead is the kind of business this vertical targets. NYC's
// home-improvement contractor licence lives in the DCWP dataset instead.
//
// Like the Delaware septic list, the emails are a mix of business domains and
// personal free-mail addresses. Only a business-domain address is used as the
// lead contact; a free-mail row falls through to the normal website/email
// discovery, because a gmail address says nothing about the business's own site.

export const NYC_DOB_HOST = 'data.cityofnewyork.us';
export const NYC_DOB_DATASET = 't8hj-ruu2';
export const NYC_DOB_REGISTRY = 'New York City Department of Buildings';
export const NYC_DOB_SOURCE_URL = 'https://data.cityofnewyork.us/Housing-Development/DOB-License-Info/t8hj-ruu2';
const LIST_NOUN = 'licence file';

export const NYC_LICENSE_TYPES = ['MASTER PLUMBER', 'ELECTRICAL FIRM'] as const;
export type NycLicenseType = (typeof NYC_LICENSE_TYPES)[number];

// Short, stable prefix for the source key (licence numbers repeat across types).
const KEY_PREFIX: Record<NycLicenseType, string> = { 'MASTER PLUMBER': 'mp', 'ELECTRICAL FIRM': 'ef' };

const TYPE_LABEL: Record<NycLicenseType, string> = {
  // The master plumber licence is held by a person and the record names the
  // business they work under, so the wording says exactly that rather than
  // calling the company a licensed plumber.
  'MASTER PLUMBER': 'business listed against an active master plumber licence',
  'ELECTRICAL FIRM': 'licensed electrical firm',
};

export interface NycDobRow {
  license_sl_no?: string;
  license_type?: string;
  license_number?: string;
  license_status?: string;
  business_name?: string;
  business_name_2?: string;
  business_house_number?: string;
  business_street_name?: string;
  business_state?: string;
  business_zip_code?: string;
  business_email?: string;
  business_phone_number?: string;
  bbl?: string;
  first_name?: string;
  last_name?: string;
}

export type Evaluation =
  | { keep: true; adjust: number; reasons: string[]; licenseType: NycLicenseType }
  | { keep: false; reason: string };

// `license_business_city` in this dataset is truncated to two characters ("BR",
// "CO", "NE"), so it is unusable. The borough comes from the first digit of the
// BBL (borough-block-lot), which is a fixed NYC convention.
const BOROUGH: Record<string, string> = { '1': 'Manhattan', '2': 'Bronx', '3': 'Brooklyn', '4': 'Queens', '5': 'Staten Island' };

export function boroughFromBbl(bbl: string | undefined | null): string | null {
  const b = (bbl ?? '').trim();
  return b.length >= 10 ? (BOROUGH[b[0]] ?? null) : null;
}

// City agencies, authorities and the big mechanical/utility firms whose NYC
// licences are in this file: not owner-run service businesses.
const BIG_NYC = /\b(dept\.? of|department of|city of new york|housing authority|\bnycha\b|\bmta\b|port authority|transit authority|board of education|con ?ed(ison)?|national grid|\bnyu\b|columbia university|mount sinai|northwell|presbyterian|\bemcor\b|comfort systems|\bara ?mark\b|\bjll\b|cushman|related companies|tishman|turner construction|skanska|structure tone|\bams\b mechanical|roto[- ]?rooter)\b/i;

export function evaluateNycDobRow(r: NycDobRow): Evaluation {
  const licenseType = (r.license_type ?? '').trim().toUpperCase();
  if (!NYC_LICENSE_TYPES.includes(licenseType as NycLicenseType)) return { keep: false, reason: 'licence type not in scope' };
  if ((r.license_status ?? '').trim().toUpperCase() !== 'ACTIVE') return { keep: false, reason: 'licence not active' };
  const name = (r.business_name ?? '').trim();
  if (!name) return { keep: false, reason: 'no business name' };
  if (!(r.license_number ?? '').trim()) return { keep: false, reason: 'no licence number' };
  if (BIG_NYC.test(name)) return { keep: false, reason: 'agency, institution or large mechanical/utility firm' };

  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };
  const email = cleanEmail(r.business_email);
  if (!email) add(-10, 'no business email in the licence record');
  else if (isFreeMail(email)) add(-5, 'licence record email is a free-mail address (no business domain to verify)');
  else add(5, 'business-domain email published in the licence record');
  if (!formatUsPhone(r.business_phone_number)) add(-5, 'no usable phone in the licence record');
  return { keep: true, adjust, reasons, licenseType: licenseType as NycLicenseType };
}

export function toNycDobLead(r: NycDobRow, ev: { adjust: number; reasons: string[]; licenseType: NycLicenseType }): RegistryLead {
  const { legal, dba } = splitDba((r.business_name as string).replace(/\s+/g, ' ').trim());
  const name = titleCase(dba ?? legal);
  const legalName = dba ? titleCase(legal) : null;
  const city = boroughFromBbl(r.bbl);
  const state = (r.business_state ?? '').trim().toUpperCase() || 'NY';
  const location = cityState(city, state);
  const typeLabel = TYPE_LABEL[ev.licenseType];
  const licenseId = (r.license_number as string).trim().toUpperCase();
  const phone = formatUsPhone(r.business_phone_number);
  const email = cleanEmail(r.business_email);
  // Delaware rule: a personal free-mail address is not treated as the
  // business's contact, only as a scoring signal.
  const usable = email && !isFreeMail(email) ? email : null;
  return {
    sourceKey: `homeservices:nyc:${KEY_PREFIX[ev.licenseType]}-${licenseId}`,
    name,
    legalName,
    city,
    state,
    phone,
    licenseId,
    registryName: NYC_DOB_REGISTRY,
    typeLabel,
    contactName: null,
    location,
    description: describeRegistryLead({ typeLabel, registryName: NYC_DOB_REGISTRY, location, legalName, name, listNoun: LIST_NOUN }),
    signalDetail: `NYC DOB ${ev.licenseType.toLowerCase()} licence ${licenseId}${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: usable,
    contactSourceUrl: usable ? NYC_DOB_SOURCE_URL : null,
  };
}

// ---- network ---------------------------------------------------------------

const SELECT = 'license_sl_no,license_type,license_number,license_status,business_name,business_house_number,business_street_name,business_state,business_zip_code,business_email,business_phone_number,bbl,first_name,last_name';

function where(types: readonly string[]): string {
  return `license_status='ACTIVE' AND license_type in(${types.map((t) => `'${t}'`).join(',')})`;
}

export async function fetchNycDobRows(
  opts: { limit?: number; offset?: number; types?: readonly NycLicenseType[]; log?: (m: string) => void } = {},
): Promise<NycDobRow[]> {
  return socrataGet<NycDobRow>(NYC_DOB_HOST, NYC_DOB_DATASET, {
    $where: where(opts.types ?? NYC_LICENSE_TYPES),
    $order: 'license_sl_no',
    $limit: String(opts.limit ?? 500),
    $offset: String(opts.offset ?? 0),
    $select: SELECT,
  }, opts.log ?? (() => {}));
}

export async function countNycDobRows(types: readonly NycLicenseType[] = NYC_LICENSE_TYPES, log: (m: string) => void = () => {}): Promise<number> {
  const rows = await socrataGet<{ count: string }>(NYC_DOB_HOST, NYC_DOB_DATASET, { $select: 'count(*)', $where: where(types) }, log);
  return Number(rows[0]?.count) || 0;
}

const DAY_MS = 86_400_000;
const PAGE = 500;

// ~2,270 active rows across the two licence types: one day-rotating page per
// run, the same shape as the WA L&I source.
export async function findNycDobCandidates(
  max: number,
  opts: { now?: Date; offsetOverride?: number; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const result = emptyResult();
  try {
    const total = await countNycDobRows(NYC_LICENSE_TYPES, log);
    if (total <= 0) throw new Error('could not read the active licence count');
    const day = Math.floor(now.getTime() / DAY_MS);
    const offset = opts.offsetOverride ?? (day * PAGE) % Math.max(1, total);
    const rows = await fetchNycDobRows({ limit: PAGE, offset, log });
    result.scanned = rows.length;
    for (const r of rows) {
      if (result.candidates.length >= max) break;
      const ev = evaluateNycDobRow(r);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      const lead = toNycDobLead(r, ev);
      if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); continue; }
      result.candidates.push(lead);
    }
  } catch (e) {
    result.errors.push(`homeservices nyc: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

// Whole-population pass for the one-off bulk import: pages through every active
// row of both licence types.
export async function allNycDobLeads(
  opts: { isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const log = opts.log ?? (() => {});
  const result = emptyResult();
  try {
    for (let offset = 0; ; offset += PAGE) {
      const rows = await fetchNycDobRows({ limit: PAGE, offset, log });
      if (!rows.length) break;
      result.scanned += rows.length;
      for (const r of rows) {
        const ev = evaluateNycDobRow(r);
        if (!ev.keep) { reject(result, ev.reason); continue; }
        const lead = toNycDobLead(r, ev);
        if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); continue; }
        result.candidates.push(lead);
      }
      if (rows.length < PAGE) break;
    }
  } catch (e) {
    result.errors.push(`homeservices nyc bulk: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
