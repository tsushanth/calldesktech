import { DISCOVERY_UA } from './http';
import { scoreChildcareRow, toCapacity } from './childcareUs';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';

// Arizona child care discovery from the Arizona Department of Health Services
// Bureau of Child Care Licensing public GIS layer "State Licensed Childcare
// Facilities in Arizona" (ArcGIS FeatureService layer 17 of AZLicensedFacilities,
// published at https://geodata-adhsgis.hub.arcgis.com/datasets/state-licensed-childcare-facilities-in-arizona).
//
// Verified 2026-09-30: 2,536 rows, every one OPERATION_STATUS 'Active'
// (2,258 Child Care Center, 278 Child Care Group Home), 99.9% with a 10-digit
// Telephone, NO email. CAVEAT: the layer's RUN_DATE is 2025-02-03 for every row,
// so this is a snapshot about 20 months old; closures since then are not
// reflected. A phone-first lead whose number has gone dead costs one call, and
// the AZ Care Check lookup (https://azcarecheck.azdhs.gov) can confirm a
// licence, which is why the licence number is carried on the lead.
//
// Open ArcGIS REST endpoint, no key, 1,000 rows per page (exceededTransferLimit).

export const AZ_CC_LAYER = 'https://services1.arcgis.com/mpVYz37anSdrK4d8/arcgis/rest/services/AZLicensedFacilities/FeatureServer/17';
export const AZ_CC_SOURCE_URL = 'https://geodata-adhsgis.hub.arcgis.com/datasets/state-licensed-childcare-facilities-in-arizona';
export const AZ_CC_REGISTRY = 'Arizona Department of Health Services, Bureau of Child Care Licensing';
const LIST_NOUN = 'licensed facility layer';

export interface AzChildcareRow {
  FACID?: string | null;
  FACILITY_NAME?: string | null;
  LICENSE_NUMBER?: string | null;
  Telephone?: string | null;
  TYPE?: string | null;
  Capacity?: string | number | null;
  ADDRESS?: string | null;
  CITY?: string | null;
  ZIP?: string | number | null;
  OPERATION_STATUS?: string | null;
  license_expiration?: number | null; // epoch ms; null for every row at verification time
  RUN_DATE?: number | null;
}

const CHAIN = /\b(kindercare|knowledge (beginnings|universal)|bright horizons|goddard school|primrose school|la petite academy|childtime|tutor time|learning care group|everbrook|right at school|kids ?r ?kids|sunshine house|cr[eè]me de la cr[eè]me|lightbridge academy|celebree|guidepost montessori|new horizon academy|children'?s lighthouse|cadence education|endeavor schools|the learning experience|nobel learning|childcare network|\bymca\b|\bywca\b|boys (and|&) girls club|challenge island|arizona child care association)\b/i;

export type Evaluation = { keep: true; adjust: number; reasons: string[]; typeLabel: string } | { keep: false; reason: string };

export function azIdOf(r: AzChildcareRow): string {
  return (r.LICENSE_NUMBER || r.FACID || '').trim();
}

export function evaluateAzChildcareRow(r: AzChildcareRow, now = new Date()): Evaluation {
  const id = azIdOf(r);
  if (!id) return { keep: false, reason: 'no licence id' };
  const name = (r.FACILITY_NAME ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { keep: false, reason: 'no facility name' };
  if ((r.OPERATION_STATUS ?? '').trim().toLowerCase() !== 'active') return { keep: false, reason: 'facility not active' };
  if (r.license_expiration && r.license_expiration < now.getTime()) return { keep: false, reason: 'licence expired' };
  if (CHAIN.test(name)) return { keep: false, reason: 'national child care chain or large non-profit name' };
  const phone = formatUsPhone(r.Telephone);
  if (!phone) return { keep: false, reason: 'no usable phone (no email in this source either)' };
  const { adjust, reasons } = scoreChildcareRow({ name, email: null, phone, capacity: toCapacity(String(Math.round(Number(r.Capacity ?? 0)) || '')) });
  // Capacity arrives as "54.0"; toCapacity strips non-digits, so round to an integer first.
  // scoreChildcareRow charges -10 for no email; this source never has one, so the
  // phone is the contact. Offset most of it so a phone-callable lead is not buried.
  const typeLabel = /group home/i.test(r.TYPE ?? '') ? 'licensed child care group home' : 'licensed child care center';
  return { keep: true, adjust: adjust + 6, reasons: [...reasons, '+6: phone-first source (every row has a phone, none has an email)'], typeLabel };
}

export function toAzChildcareLead(r: AzChildcareRow, ev: { adjust: number; reasons: string[]; typeLabel: string }): RegistryLead {
  const id = azIdOf(r);
  const name = titleCase((r.FACILITY_NAME ?? '').replace(/\s+/g, ' ').trim());
  const city = (r.CITY ?? '').trim() || null;
  const location = cityState(city, 'AZ');
  const phone = formatUsPhone(r.Telephone);
  return {
    sourceKey: `childcare:az:${id.toUpperCase()}`,
    name,
    legalName: null,
    city: city ? titleCase(city) : null,
    state: 'AZ',
    phone,
    licenseId: id.toUpperCase(),
    registryName: AZ_CC_REGISTRY,
    typeLabel: ev.typeLabel,
    contactName: null,
    location,
    description: describeRegistryLead({ typeLabel: ev.typeLabel, registryName: AZ_CC_REGISTRY, location, legalName: null, name, listNoun: LIST_NOUN }),
    signalDetail: `AZ DHS child care licence ${id}${r.Capacity ? `; capacity ${r.Capacity}` : ''}${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: null,
    contactSourceUrl: null,
  };
}

// ---- network ---------------------------------------------------------------

export async function fetchAzChildcareRows(opts: { layerUrl?: string; log?: (m: string) => void } = {}): Promise<AzChildcareRow[]> {
  const base = opts.layerUrl ?? AZ_CC_LAYER;
  const out: AzChildcareRow[] = [];
  for (let offset = 0; offset < 20_000;) {
    const qs = new URLSearchParams({ where: '1=1', outFields: '*', returnGeometry: 'false', f: 'json', orderByFields: 'OBJECTID', resultOffset: String(offset), resultRecordCount: '1000' });
    const res = await fetch(`${base}/query?${qs.toString()}`, { headers: { 'User-Agent': DISCOVERY_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`AZ ADHS GIS unavailable (HTTP ${res.status})`);
    const j = (await res.json()) as { features?: { attributes: AzChildcareRow }[]; exceededTransferLimit?: boolean; error?: { message?: string } };
    if (j.error) throw new Error(`AZ ADHS GIS error: ${j.error.message ?? 'unknown'}`);
    const feats = j.features ?? [];
    for (const f of feats) out.push(f.attributes);
    opts.log?.(`az childcare: ${out.length} rows`);
    if (!feats.length || !j.exceededTransferLimit) break;
    offset += feats.length;
  }
  if (out.length < 500) throw new Error(`AZ ADHS child care layer returned only ${out.length} rows`);
  return out;
}

export async function streamAzChildcareLeads(
  opts: { now?: Date; isKnown?: (sourceKey: string) => boolean; rows?: AzChildcareRow[]; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();
  const rows = opts.rows ?? (await fetchAzChildcareRows({ log: opts.log }));
  for (const r of rows) {
    result.scanned++;
    const ev = evaluateAzChildcareRow(r, now);
    if (!ev.keep) { reject(result, ev.reason); continue; }
    const lead = toAzChildcareLead(r, ev);
    if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); continue; }
    result.candidates.push(lead);
  }
  return result;
}

const DAY_MS = 86_400_000;

export async function findAzChildcareCandidates(
  max: number,
  opts: { now?: Date; startOverride?: number; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();
  try {
    const all = await streamAzChildcareLeads({ now, isKnown: opts.isKnown, log: opts.log });
    result.scanned = all.scanned;
    result.rejected = all.rejected;
    if (!all.candidates.length) return result;
    const day = Math.floor(now.getTime() / DAY_MS);
    const start = opts.startOverride ?? (day * max) % all.candidates.length;
    for (let i = 0; i < all.candidates.length && result.candidates.length < max; i++) {
      result.candidates.push(all.candidates[(start + i) % all.candidates.length]);
    }
  } catch (e) {
    result.errors.push(`childcare az: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
