import { DISCOVERY_UA } from './http';
import { scoreChildcareRow, toCapacity } from './childcareUs';
import { callerPhoneExclusion, HOME_BASED_RE } from './callerPhonePolicy';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';

// Kentucky child care discovery for the `childcare` vertical, from the
// "Childcare Providers in Kentucky" ArcGIS feature service published by the
// Kentucky Division of Geographic Information (owner Kentucky_DGI, built from the
// Cabinet for Health and Family Services provider file; item last modified
// 2026-09-29). Public, no key, no login:
//   https://services3.arcgis.com/ghsX9CKghMvyYjBU/arcgis/rest/services/Ky_CHFS_ChildcareProviders_WM/FeatureServer/0
//
// Verified 2026-09-30: 2,001 rows (1,800 Licensed, 201 Certified), 100% with a
// 10-digit phone, NO email, licence expiry dates 2026-06 .. 2028-09 (none expired).
// maxRecordCount is 2,000, so the query MUST page (the 2,001st row is only reachable
// with resultOffset). Phone-only: leads go through website discovery for an email,
// or phone-first follow-up.

export const KY_CHILDCARE_URL = 'https://services3.arcgis.com/ghsX9CKghMvyYjBU/arcgis/rest/services/Ky_CHFS_ChildcareProviders_WM/FeatureServer/0';
export const KY_CHILDCARE_SOURCE_URL = 'https://www.chfs.ky.gov/agencies/dcbs/dcc/Pages/find-care.aspx';
export const KY_CHILDCARE_REGISTRY = 'Kentucky Cabinet for Health and Family Services';
const LIST_NOUN = 'child care provider data';

export interface KyChildcareRow {
  USER_CLR_?: string | null;
  USER_Name?: string | null;
  USER_County?: string | null;
  USER_Location_Address?: string | null;
  USER_Phone?: string | null;
  USER_Capacity?: number | string | null;
  USER_Provider_Type?: string | null;
  USER_Stars_Rating?: string | null;
  USER_Expiration_Date?: number | null; // epoch ms
}

const TYPE_LABEL: Record<string, string> = {
  licensed: 'licensed child care provider',
  certified: 'certified family child care home',
};

// Same national chains / franchises as the other childcare sources.
const CHAIN = /\b(kindercare|knowledge (beginnings|universal)|bright horizons|goddard school|primrose school|la petite academy|childtime|tutor time|learning care group|everbrook|right at school|kids ?r ?kids|sunshine house|cr[eè]me de la cr[eè]me|lightbridge academy|celebree|guidepost montessori|new horizon academy|children'?s lighthouse|cadence education|endeavor schools|the learning experience|nobel learning|childcare network|\bkla schools\b|\bymca\b|\bywca\b|boys (and|&) girls club)\b/i;

// "630 Whipp Avenue, Liberty,KY,42539" -> "Liberty". Last three comma parts are city, state, zip.
export function kyCityFromAddress(addr: string | null | undefined): string | null {
  const parts = (addr ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  const st = parts[parts.length - 2];
  if (!/^[A-Za-z]{2}$/.test(st)) return null;
  return parts[parts.length - 3] || null;
}

export type Evaluation = { keep: true; adjust: number; reasons: string[]; typeLabel: string } | { keep: false; reason: string };

export function evaluateKyChildcareRow(r: KyChildcareRow, now = new Date()): Evaluation {
  const type = (r.USER_Provider_Type ?? '').trim().toLowerCase();
  const typeLabel = TYPE_LABEL[type];
  if (!typeLabel) return { keep: false, reason: 'provider type not in scope' };
  const name = (r.USER_Name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { keep: false, reason: 'no provider name' };
  if (!(r.USER_CLR_ ?? '').trim()) return { keep: false, reason: 'no licence number' };
  if (typeof r.USER_Expiration_Date === 'number' && r.USER_Expiration_Date < now.getTime()) return { keep: false, reason: 'licence expired' };
  if (CHAIN.test(name)) return { keep: false, reason: 'national chain, franchise, or large multi-site operator' };
  const phone = formatUsPhone(r.USER_Phone);
  if (!phone) return { keep: false, reason: 'no usable phone (the dataset has no email)' };
  return { keep: true, typeLabel, ...scoreChildcareRow({ name, email: null, phone, capacity: toCapacity(String(r.USER_Capacity ?? '')) }) };
}

// Kentucky licenses a "Type II" centre for up to 12 children, which is the size class that is run from a
// residence (the dataset has only Licensed / Certified, no centre-vs-home flag). Certified providers are
// certified family child care homes by definition. Both are treated as home-based.
export const KY_HOME_SIZED_MAX = 12;

export function kyCallerPhoneExclusion(r: KyChildcareRow, typeLabel: string): string | null {
  const name = (r.USER_Name ?? '').replace(/\s+/g, ' ').trim();
  const cap = toCapacity(String(r.USER_Capacity ?? ''));
  const homeSized = (r.USER_Provider_Type ?? '').trim().toLowerCase() === 'licensed' && typeof cap === 'number' && cap > 0 && cap <= KY_HOME_SIZED_MAX;
  // A plain person-name check is only meaningful for home-sized / certified providers: bigger licensed centres have
  // names like "Bobcat Mountain" or "Happy Bears" that no name heuristic can tell from a person.
  const smallOrCertified = homeSized || typeLabel === TYPE_LABEL.certified;
  return callerPhoneExclusion({ name: smallOrCertified ? name : '', homeBased: homeSized || HOME_BASED_RE.test(name), typeLabel });
}

export function toKyChildcareLead(r: KyChildcareRow, ev: { adjust: number; reasons: string[]; typeLabel: string }): RegistryLead {
  const name = titleCase((r.USER_Name ?? '').replace(/\s+/g, ' ').trim());
  const city = kyCityFromAddress(r.USER_Location_Address);
  const location = cityState(city, 'KY');
  const licenseId = (r.USER_CLR_ ?? '').trim().toUpperCase();
  const phone = formatUsPhone(r.USER_Phone);
  const capacity = toCapacity(String(r.USER_Capacity ?? ''));
  const stars = (r.USER_Stars_Rating ?? '').trim();
  const callerPhoneExcluded = kyCallerPhoneExclusion(r, ev.typeLabel);
  return {
    sourceKey: `childcare:ky:${licenseId}`,
    name,
    legalName: null,
    city: city ? titleCase(city) : null,
    state: 'KY',
    phone,
    callerPhoneExcluded,
    licenseId,
    registryName: KY_CHILDCARE_REGISTRY,
    typeLabel: ev.typeLabel,
    contactName: null,
    location,
    description: describeRegistryLead({ typeLabel: ev.typeLabel, registryName: KY_CHILDCARE_REGISTRY, location, legalName: null, name, listNoun: LIST_NOUN }),
    signalDetail: `KY CHFS ${(r.USER_Provider_Type ?? '').trim()} child care ${licenseId}${r.USER_County ? `, ${titleCase(r.USER_County)} County` : ''}${capacity ? `; capacity ${capacity}` : ''}${/^\d$/.test(stars) ? `; ${stars} star` : ''}${phone && !callerPhoneExcluded ? `; phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: null,
    contactSourceUrl: null,
  };
}

// ---- network ---------------------------------------------------------------

const PAGE = 1000; // under the service's 2,000 maxRecordCount

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': DISCOVERY_UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url.split('?')[0]} unavailable (HTTP ${res.status})`);
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (body.error) throw new Error(`arcgis error: ${body.error.message ?? 'unknown'}`);
  return body;
}

export async function fetchKyChildcareRows(
  opts: { url?: string; log?: (m: string) => void } = {},
): Promise<KyChildcareRow[]> {
  const base = opts.url ?? KY_CHILDCARE_URL;
  // The layer's own row count is the truth the paged result is checked against: a short page (server cap, timeout
  // dressed as an empty page) must not come back as a successful partial import.
  const { count } = await getJson<{ count?: number }>(`${base}/query?${new URLSearchParams({ where: '1=1', returnCountOnly: 'true', f: 'json' })}`);
  if (typeof count !== 'number') throw new Error(`${base}: no row count returned`);
  const rows: KyChildcareRow[] = [];
  for (let offset = 0; offset < 50_000; offset += PAGE) {
    const qs = new URLSearchParams({
      where: '1=1', outFields: '*', returnGeometry: 'false', orderByFields: 'OBJECTID',
      resultOffset: String(offset), resultRecordCount: String(PAGE), f: 'json',
    });
    const body = await getJson<{ features?: { attributes: KyChildcareRow }[]; exceededTransferLimit?: boolean }>(`${base}/query?${qs}`);
    const feats = body.features ?? [];
    for (const f of feats) rows.push(f.attributes);
    opts.log?.(`ky childcare: ${rows.length}/${count} rows`);
    // Stop only on an empty page (or once the layer's count is reached); a short page with exceededTransferLimit continues.
    if (!feats.length || (rows.length >= count && !body.exceededTransferLimit)) break;
  }
  if (rows.length < 500) throw new Error(`${base}: only ${rows.length} rows; layer may have changed`);
  if (rows.length < count) throw new Error(`${base}: paged ${rows.length} of ${count} rows; refusing a partial import`);
  return rows;
}

export async function allKyChildcareLeads(
  opts: { now?: Date; isKnown?: (sourceKey: string) => boolean; rows?: KyChildcareRow[]; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();
  try {
    const rows = opts.rows ?? (await fetchKyChildcareRows({ log: opts.log }));
    for (const r of rows) {
      result.scanned++;
      const ev = evaluateKyChildcareRow(r, now);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      const lead = toKyChildcareLead(r, ev);
      if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); continue; }
      result.candidates.push(lead);
    }
  } catch (e) {
    result.errors.push(`childcare ky: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
