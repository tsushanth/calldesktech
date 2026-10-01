import { DISCOVERY_UA, sleep } from './http';
import { scoreChildcareRow, toCapacity } from './childcareUs';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';

// California child care CENTERS from the California Department of Social
// Services, Community Care Licensing Division facility layer, published on
// data.chhs.ca.gov / data.ca.gov (licence CC-BY) as an ArcGIS FeatureServer:
//   https://services.arcgis.com/XLPEppdz2H9dOiqp/arcgis/rest/services/CDSS_CCL_Facilities/FeatureServer/0
//
// Verified live 2026-09-30: 37,934 facility rows; the layer's lastEditDate is
// 2026-09-30. PROGRAM_TYPE='CHILD CARE' is 13,334 rows (centers only: day care
// center, infant center, school-age center, single-licence center). Of those,
// STATUS=3 is 12,750 and 12,731 (99.85%) carry a 10-digit FAC_PHONE_NBR. There is
// NO email column. (The sibling CSV downloads on data.chhs.ca.gov are a frozen
// May 2025 snapshot, so this live layer is the one to use.)
//
// STATUS is a numeric code with no published legend. Joining the layer to the
// May 2025 CSV (which has the text status) showed STATUS 3 is 'LICENSED' for 93%
// of rows and otherwise PENDING/INACTIVE/PROBATION (~3%); STATUS 4/5/6 are a mix
// and are excluded. CLOSED facilities are not in the layer at all.
//
// Family child care HOMES are deliberately NOT in this loader: the live layer
// does not carry them, and the CSV that does (13,986 licensed) is a home-based,
// individual-licensee population with private-residence phones.
//
// Phone-first: no email, so stageEnrich resolves a website the way Texas/PA
// childcare leads without an email do.

export const CA_CCL_LAYER_URL = 'https://services.arcgis.com/XLPEppdz2H9dOiqp/arcgis/rest/services/CDSS_CCL_Facilities/FeatureServer/0';
export const CA_CCL_DATASET_URL = 'https://data.chhs.ca.gov/dataset/community-care-licensing-facilities';
export const CA_CCL_REGISTRY = 'California Department of Social Services Community Care Licensing';
const LIST_NOUN = 'facility licensing data';
const TYPE_LABEL = 'licensed child care center';
const PAGE = 1000;

export interface CaCclRow {
  FAC_NBR?: number | string | null;
  NAME?: string | null;
  PROGRAM_TYPE?: string | null;
  FAC_TYPE_DESC?: string | null;
  STATUS?: number | string | null;
  CAPACITY?: number | string | null;
  RES_CITY?: string | null;
  RES_STATE?: string | null;
  FAC_PHONE_NBR?: number | string | null;
  COUNTY?: string | null;
}

// Same intent as childcareUs.CHAIN (which is not exported), extended with the
// California-heavy operators and the large non-profit after-school providers.
const CHAIN = /\b(kindercare|knowledge (beginnings|universal)|bright horizons|goddard school|primrose school|la petite academy|childtime|tutor time|learning care group|everbrook|right at school|kids ?r ?kids|sunshine house|cr[eè]me de la cr[eè]me|lightbridge academy|celebree|guidepost montessori|new horizon academy|children'?s lighthouse|cadence education|endeavor schools|the learning experience|nobel learning|childcare network|\bkla schools\b|young scholars academy of|\bymca\b|\bywca\b|boys (and|&) girls club|kidango|bananas|learning without tears|jcc|jewish community center|city of|county of|ucla|uc davis|uc berkeley|ucsf|stanford|head start|\bymca\b|bay area community services|ccrc|first 5)\b/i;

export type Evaluation = { keep: true; adjust: number; reasons: string[] } | { keep: false; reason: string };

export function evaluateCaCclRow(r: CaCclRow): Evaluation {
  if ((r.PROGRAM_TYPE ?? '').trim().toUpperCase() !== 'CHILD CARE') return { keep: false, reason: 'not a child care center (adult, senior or children residential program)' };
  if (Number(r.STATUS) !== 3) return { keep: false, reason: 'status code is not 3 (licensed)' };
  const name = (r.NAME ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { keep: false, reason: 'no facility name' };
  if (!String(r.FAC_NBR ?? '').trim()) return { keep: false, reason: 'no facility number' };
  if (CHAIN.test(name)) return { keep: false, reason: 'national chain, franchise, or large multi-site operator' };
  const phone = formatUsPhone(r.FAC_PHONE_NBR == null ? null : String(r.FAC_PHONE_NBR));
  if (!phone) return { keep: false, reason: 'no usable phone (the layer has no email)' };
  const cap = toCapacity(r.CAPACITY == null ? null : String(r.CAPACITY));
  const s = scoreChildcareRow({ name, email: null, phone, capacity: cap });
  // scoreChildcareRow charges -10 for "no email"; for a phone-first source that
  // is the normal state, so the penalty is halved rather than counted in full.
  const reasons = [...s.reasons, '+5: registry phone published for phone-first follow-up (offsets half of the no-email penalty)'];
  return { keep: true, adjust: s.adjust + 5, reasons };
}

export function caCclSourceKey(r: CaCclRow): string {
  return `childcare:ca:${String(r.FAC_NBR).trim()}`;
}

export function toCaCclLead(r: CaCclRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const name = titleCase((r.NAME ?? '').replace(/\s+/g, ' ').trim());
  const city = (r.RES_CITY ?? '').trim() || null;
  const location = cityState(city, 'CA');
  const phone = formatUsPhone(r.FAC_PHONE_NBR == null ? null : String(r.FAC_PHONE_NBR));
  const licenseId = String(r.FAC_NBR).trim();
  const capacity = toCapacity(r.CAPACITY == null ? null : String(r.CAPACITY));
  return {
    sourceKey: caCclSourceKey(r),
    name,
    legalName: null,
    city: city ? titleCase(city) : null,
    state: 'CA',
    phone,
    licenseId,
    registryName: CA_CCL_REGISTRY,
    typeLabel: TYPE_LABEL,
    contactName: null,
    location,
    description: describeRegistryLead({ typeLabel: TYPE_LABEL, registryName: CA_CCL_REGISTRY, location, legalName: null, name, listNoun: LIST_NOUN }),
    signalDetail: `CA CDSS CCL facility ${licenseId}${r.COUNTY ? `, ${r.COUNTY.replace(/\s*county$/i, '').trim()} County` : ''}${capacity ? `; capacity ${capacity}` : ''}${phone ? `; phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: null,
    contactSourceUrl: null,
  };
}

// ---- network ---------------------------------------------------------------

interface ArcPage { features?: { attributes: CaCclRow & { ObjectId?: number } }[]; exceededTransferLimit?: boolean; error?: { message?: string } }

async function fetchPage(offset: number, log: (m: string) => void): Promise<ArcPage> {
  const qs = new URLSearchParams({
    where: "PROGRAM_TYPE='CHILD CARE' AND STATUS=3",
    outFields: 'FAC_NBR,NAME,PROGRAM_TYPE,FAC_TYPE_DESC,STATUS,CAPACITY,RES_CITY,RES_STATE,FAC_PHONE_NBR,COUNTY',
    returnGeometry: 'false', orderByFields: 'ObjectId', resultOffset: String(offset), resultRecordCount: String(PAGE), f: 'json',
  });
  let delay = 2000;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${CA_CCL_LAYER_URL}/query?${qs}`, { headers: { 'User-Agent': DISCOVERY_UA, Accept: 'application/json' } });
      if (res.ok) {
        const j = (await res.json()) as ArcPage;
        if (!j.error && Array.isArray(j.features)) return j;
        throw new Error(j.error?.message ?? 'unexpected response shape');
      }
      if (res.status < 500 && res.status !== 429) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (attempt === 3) throw e;
      log(`CA CCL layer retry in ${delay}ms (${e instanceof Error ? e.message : String(e)})`);
    }
    await sleep(delay);
    delay *= 2;
  }
  throw new Error('CA CCL layer unavailable');
}

export async function allCaCclLeads(
  opts: { isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void; fetchRows?: () => Promise<CaCclRow[]> } = {},
): Promise<RegistryResult> {
  const result = emptyResult();
  const log = opts.log ?? (() => {});
  try {
    let rows: CaCclRow[] = [];
    if (opts.fetchRows) rows = await opts.fetchRows();
    else {
      for (let offset = 0; ; offset += PAGE) {
        const page = await fetchPage(offset, log);
        const feats = page.features ?? [];
        rows.push(...feats.map((f) => f.attributes));
        if (!feats.length || !page.exceededTransferLimit) break;
        await sleep(300);
      }
    }
    if (rows.length < 1000) throw new Error(`CA CCL layer returned only ${rows.length} child care rows; layer may have changed`);
    for (const r of rows) {
      result.scanned++;
      const ev = evaluateCaCclRow(r);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      const lead = toCaCclLead(r, ev);
      if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); continue; }
      result.candidates.push(lead);
    }
  } catch (e) {
    result.errors.push(`childcare ca ccl: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

const DAY_MS = 86_400_000;

export async function findCaCclCandidates(
  max: number,
  opts: { now?: Date; startOverride?: number; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();
  const all = await allCaCclLeads({ isKnown: opts.isKnown, log: opts.log });
  result.scanned = all.scanned;
  result.rejected = all.rejected;
  result.errors.push(...all.errors);
  if (!all.candidates.length) return result;
  const day = Math.floor(now.getTime() / DAY_MS);
  const start = opts.startOverride ?? (day * max) % all.candidates.length;
  for (let i = 0; i < all.candidates.length && result.candidates.length < max; i++) {
    result.candidates.push(all.candidates[(start + i) % all.candidates.length]);
  }
  return result;
}
