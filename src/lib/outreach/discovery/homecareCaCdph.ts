import { streamDelimitedRows } from './delimitedStream';
import { cleanEmail, isFreeMail } from './freightFmcsa';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';
import { classifyHomecareName } from './homecareRegistry';

// Home-care discovery from the California Department of Public Health licensed
// and certified healthcare facility file (data.chhs.ca.gov). The whole file is
// every licensed facility in California (~15k rows); two facility types are used
// (verified 2026-09-24, all with LICENSE_STATUS_DESCRIPTION 'ACTIVE'):
//
//   FAC_TYPE_CODE=HHA     + FAC_STATUS_TYPE_CODE=OPEN  4,117 rows, 4,056 with CONTACT_EMAIL
//   FAC_TYPE_CODE=HOSPICE + FAC_STATUS_TYPE_CODE=OPEN  2,060 rows, 2,015 with CONTACT_EMAIL
//
// These are MEDICAL home health agencies and hospices (a state facility licence),
// not the non-medical companion-care agencies that make up much of the homecare
// vertical, so the lead description says exactly what the file says: "listed in
// the California Department of Public Health licensed facility file as a home
// health agency". classifyHomecareName's medical/non-medical scoring already
// marks a skilled-nursing-style name down.
//
// CONTACT_EMAIL is the named facility administrator's address at the facility's
// own domain in most rows. Where it is a free-mail address the Delaware rule
// applies: it is a scoring signal only and the lead goes through the normal
// website/email discovery.

export const CA_CDPH_CSV_URL = 'https://data.chhs.ca.gov/dataset/3b5b80e8-6b8d-4715-b3c0-2699af6e72e5/resource/f0ae5731-fef8-417f-839d-54a0ed3a126e/download/health_facility_locations.csv';
export const CA_CDPH_DATASET_URL = 'https://data.chhs.ca.gov/dataset/3b5b80e8-6b8d-4715-b3c0-2699af6e72e5';
export const CA_CDPH_REGISTRY = 'California Department of Public Health';
const LIST_NOUN = 'licensed facility file';

export const CA_FAC_TYPES = ['HHA', 'HOSPICE'] as const;
export type CaFacType = (typeof CA_FAC_TYPES)[number];

const TYPE_LABEL: Record<CaFacType, string> = {
  HHA: 'home health agency',
  HOSPICE: 'hospice',
};

export const CA_COL = {
  facId: 'FACID',
  facName: 'FACNAME',
  businessName: 'BUSINESS_NAME',
  facType: 'FAC_TYPE_CODE',
  facStatus: 'FAC_STATUS_TYPE_CODE',
  address: 'ADDRESS',
  city: 'CITY',
  zip: 'ZIP',
  county: 'COUNTY_NAME',
  email: 'CONTACT_EMAIL',
  phone: 'CONTACT_PHONE_NUMBER',
  admin: 'FACADMIN',
  npi: 'NPI',
  licenseNumber: 'LICENSE_NUMBER',
  licenseStatus: 'LICENSE_STATUS_DESCRIPTION',
} as const;

export interface CaCdphRow {
  facId: string;
  facName: string;
  businessName: string | null;
  facType: string;
  facStatus: string;
  city: string | null;
  zip: string | null;
  county: string | null;
  email: string | null;
  phone: string | null;
  admin: string | null;
  npi: string | null;
  licenseNumber: string | null;
  licenseStatus: string | null;
}

export function toCaCdphRow(o: Record<string, string>): CaCdphRow {
  const v = (k: string) => (o[k] ?? '').trim() || null;
  return {
    facId: (o[CA_COL.facId] ?? '').trim(),
    facName: (o[CA_COL.facName] ?? '').replace(/\s+/g, ' ').trim(),
    businessName: v(CA_COL.businessName),
    facType: (o[CA_COL.facType] ?? '').trim().toUpperCase(),
    facStatus: (o[CA_COL.facStatus] ?? '').trim().toUpperCase(),
    city: v(CA_COL.city),
    zip: v(CA_COL.zip),
    county: v(CA_COL.county),
    email: v(CA_COL.email),
    phone: v(CA_COL.phone),
    admin: v(CA_COL.admin),
    npi: v(CA_COL.npi),
    licenseNumber: v(CA_COL.licenseNumber),
    licenseStatus: v(CA_COL.licenseStatus),
  };
}

// Hospital-owned and large California health systems: their home health and
// hospice licences are all in this file and they are not owner-run agencies.
// (classifyHomecareName already rejects "hospital", "medical center",
// "university" and the like; these are the CA system brands it cannot know.)
const CA_HEALTH_SYSTEM = /\b(kaiser|sutter|providence|dignity health|adventist|scripps|cedars[- ]sinai|stanford|\bucla\b|\bucsf\b|\bucsd\b|\buc davis\b|uc irvine|memorialcare|sharp healthcare|hoag|cottage health|john muir|cedars|city of hope|loma linda|cottage hospital|prime healthcare|tenet|commonspirit|\bchoc\b|st\.? joseph health|mission hospital|salinas valley|el camino health|palomar health|torrance memorial|\bvitas\b|kindred|amedisys|encompass health|enhabit|gentiva|accentcare|bayada|\bbrookdale\b)\b/i;

export type Evaluation = { keep: true; adjust: number; reasons: string[]; facType: CaFacType } | { keep: false; reason: string };

export function evaluateCaCdphRow(r: CaCdphRow): Evaluation {
  if (!CA_FAC_TYPES.includes(r.facType as CaFacType)) return { keep: false, reason: 'facility type not in scope' };
  if (r.facStatus !== 'OPEN') return { keep: false, reason: 'facility not open' };
  if ((r.licenseStatus ?? '').toUpperCase() !== 'ACTIVE') return { keep: false, reason: 'licence not active' };
  if (!r.facName) return { keep: false, reason: 'no facility name' };
  if (!r.licenseNumber && !r.facId) return { keep: false, reason: 'no licence number' };

  const cls = classifyHomecareName(r.facName, r.businessName);
  if (!cls.keep) return cls;
  let adjust = cls.adjust;
  const reasons = [...cls.reasons];
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };
  // Deprioritised rather than rejected: a system-owned agency is still a real
  // licensed agency, just a much worse fit than an independent.
  if (CA_HEALTH_SYSTEM.test(`${r.facName} ${r.businessName ?? ''}`)) add(-20, 'part of a large health system or national home-health chain');
  const email = cleanEmail(r.email);
  if (!email) add(-10, 'no contact email in the licensed facility file');
  else if (isFreeMail(email)) add(-5, 'contact is a free-mail address (no business domain to verify)');
  else add(5, 'business-domain contact email published in the licensed facility file');
  if (!formatUsPhone(r.phone)) add(-5, 'no usable phone in the facility record');
  return { keep: true, adjust, reasons, facType: r.facType as CaFacType };
}

export function toCaCdphLead(r: CaCdphRow, ev: { adjust: number; reasons: string[]; facType: CaFacType }): RegistryLead {
  const name = titleCase(r.facName);
  // BUSINESS_NAME is the licensee entity; kept as the legal name only when it
  // differs from the facility name, and never used in a draft.
  const legalName = r.businessName && r.businessName.toUpperCase() !== r.facName.toUpperCase() ? titleCase(r.businessName) : null;
  const location = cityState(r.city, 'CA');
  const typeLabel = TYPE_LABEL[ev.facType];
  const licenseId = (r.licenseNumber || r.facId).toUpperCase();
  const phone = formatUsPhone(r.phone);
  const email = cleanEmail(r.email);
  const usable = email && !isFreeMail(email) ? email : null;
  return {
    sourceKey: `homecare:ca:${licenseId}`,
    name,
    legalName,
    city: r.city ? titleCase(r.city) : null,
    state: 'CA',
    phone,
    licenseId,
    registryName: CA_CDPH_REGISTRY,
    typeLabel,
    contactName: null,
    location,
    description: describeRegistryLead({ typeLabel, registryName: CA_CDPH_REGISTRY, location, legalName, name, listNoun: LIST_NOUN }),
    signalDetail: `CA CDPH ${ev.facType === 'HHA' ? 'home health agency' : 'hospice'} licence ${licenseId}${r.county ? `, ${titleCase(r.county)} County` : ''}${phone ? `; facility phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: usable,
    contactSourceUrl: usable ? CA_CDPH_DATASET_URL : null,
  };
}

// ---- network ---------------------------------------------------------------

const REQUIRED = [CA_COL.facType, CA_COL.facStatus, CA_COL.facName, CA_COL.email];

export async function streamCaCdphLeads(
  opts: { facTypes?: readonly CaFacType[]; isKnown?: (sourceKey: string) => boolean; url?: string; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const wanted = new Set<string>(opts.facTypes ?? CA_FAC_TYPES);
  const result = emptyResult();
  await streamDelimitedRows({
    url: opts.url ?? CA_CDPH_CSV_URL,
    delimiter: 'comma',
    requiredColumns: REQUIRED,
    minRows: 500,
    log: opts.log,
    onRow: (o) => {
      // Cheap pre-filter: the file is 7 MB of every licensed facility in the state.
      if (!wanted.has((o[CA_COL.facType] ?? '').trim().toUpperCase())) return;
      result.scanned++;
      const r = toCaCdphRow(o);
      const ev = evaluateCaCdphRow(r);
      if (!ev.keep) { reject(result, ev.reason); return; }
      const lead = toCaCdphLead(r, ev);
      if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); return; }
      result.candidates.push(lead);
    },
  });
  return result;
}

const DAY_MS = 86_400_000;

// Home health agencies are the target population; hospices are a smaller, less
// well-fitting group, so they get one run in four rather than half the runs.
export function caFacTypesForDay(day: number): readonly CaFacType[] {
  return ((day % 4) + 4) % 4 === 3 ? (['HOSPICE'] as const) : (['HHA'] as const);
}

export async function findCaCdphCandidates(
  max: number,
  opts: { now?: Date; facTypes?: readonly CaFacType[]; startOverride?: number; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const day = Math.floor(now.getTime() / DAY_MS);
  const facTypes = opts.facTypes ?? caFacTypesForDay(day);
  const result = emptyResult();
  try {
    const all = await streamCaCdphLeads({ facTypes, isKnown: opts.isKnown, log: opts.log });
    result.scanned = all.scanned;
    result.rejected = all.rejected;
    if (!all.candidates.length) return result;
    const start = opts.startOverride ?? (day * max) % all.candidates.length;
    for (let i = 0; i < all.candidates.length && result.candidates.length < max; i++) {
      result.candidates.push(all.candidates[(start + i) % all.candidates.length]);
    }
  } catch (e) {
    result.errors.push(`homecare ca: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
