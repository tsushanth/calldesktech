import { DISCOVERY_UA } from './http';
import { scoreChildcareRow, toCapacity } from './childcareUs';
import { titleCase, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';

// Child care ingestion for two Midwest states whose licensing data is public but
// contains NO email (phone-first leads; stageEnrich resolves the website):
//
//   wi-childcare  Wisconsin DCF licensed providers, published by the Dept of Health
//                 Services Open Spatial Data Portal as an ArcGIS MapServer layer
//                 https://dhsgis.wi.gov/server/rest/services/DHS_DCF/Child_Care/MapServer/0
//                 (item 0f8e25b2fe314ed88feb97ebed47bfe8, "Wisconsin Child Care
//                 Providers"; layer last modified 2025-08-13, i.e. NOT nightly).
//                 Verified live 2026-09-30: 4,733 rows, LocationPrimaryPhoneNumber
//                 on 4,733 (100%), City on 4,729. CategoryType: LICENSED GROUP
//                 2,382, LICENSED FAMILY 1,600, REGULAR CERTIFIED 543, PUBLIC SCHOOL
//                 PROGRAM 193, PROVISIONAL CERTIFIED 15. Only the two LICENSED
//                 types are kept (3,982): "certified" providers are county-certified
//                 family care and school programmes are institutional, the same
//                 line childcareUs.ts draws for TX "Registered"/"Listed" homes.
//
//   in-childcare  Indiana FSSA Office of Early Childhood and Out-of-School Learning
//                 "Child Care Provider Listings" page, which embeds the whole
//                 register as three HTML tables (centers, homes, registered
//                 ministries) for its own download buttons:
//                 https://www.in.gov/fssa/carefinder/family-resources/forms/child-care-provider-listings
//                 Verified live 2026-09-30: 3,315 rows, phone on 3,315 (100%): 770
//                 Licensed Center (with street address), 1,813 Licensed Home (NO
//                 address: Indiana Code 12-17.2-2-1(9) forbids listing home
//                 addresses, so only the county is known), 732 Unlicensed
//                 Registered Ministry (skipped, registration not a licence).
//
// Neither has an email column. Licensing records only; nothing about the
// operation is stated beyond what the register says.

export const WI_CC_URL = 'https://dhsgis.wi.gov/server/rest/services/DHS_DCF/Child_Care/MapServer/0';
export const WI_CC_REGISTRY = 'Wisconsin Department of Children and Families';
export const WI_CC_SOURCE_URL = 'https://data.dhsgis.wi.gov/datasets/0f8e25b2fe314ed88feb97ebed47bfe8';
export const IN_CC_URL = 'https://www.in.gov/fssa/carefinder/family-resources/forms/child-care-provider-listings';
export const IN_CC_REGISTRY = 'Indiana Family and Social Services Administration';
const LIST_NOUN = 'child care provider listing';

// Same national / large multi-site list as childcareUs.ts (kept local because that
// constant is not exported).
const CHAIN = /\b(kindercare|knowledge (beginnings|universal)|bright horizons|goddard school|primrose school|la petite academy|childtime|tutor time|learning care group|everbrook|right at school|kids ?r ?kids|sunshine house|cr[eè]me de la cr[eè]me|lightbridge academy|celebree|guidepost montessori|new horizon academy|children'?s lighthouse|cadence education|endeavor schools|the learning experience|nobel learning|childcare network|\bkla schools\b|young scholars academy of|\bymca\b|\bywca\b|boys (and|&) girls club)\b/i;

export type Evaluation = { keep: true; adjust: number; reasons: string[] } | { keep: false; reason: string };

// ---- Wisconsin --------------------------------------------------------------

export const WI_TYPE_LABEL: Record<string, string> = {
  'LICENSED GROUP': 'licensed group child care center',
  'LICENSED FAMILY': 'licensed family child care home',
};

export interface WiChildcareRow {
  FacilityNumber?: string | null;
  FacilityName?: string | null;
  LocationContactFullName?: string | null;
  LocationPrimaryPhoneNumber?: string | null;
  City?: string | null;
  State?: string | null;
  CategoryType?: string | null;
  Capacity?: number | string | null;
}

const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

export function evaluateWiRow(r: WiChildcareRow): Evaluation {
  const type = s(r.CategoryType).toUpperCase();
  if (!WI_TYPE_LABEL[type]) return { keep: false, reason: 'category not in scope (licensed group and family only)' };
  const name = s(r.FacilityName);
  if (!name) return { keep: false, reason: 'no facility name' };
  if (!s(r.FacilityNumber)) return { keep: false, reason: 'no facility number' };
  if (CHAIN.test(name)) return { keep: false, reason: 'national chain, franchise, or large multi-site operator' };
  const phone = formatUsPhone(r.LocationPrimaryPhoneNumber);
  if (!phone) return { keep: false, reason: 'no contact detail at all' };
  return { keep: true, ...scoreChildcareRow({ name, email: null, phone, capacity: toCapacity(s(r.Capacity)) }) };
}

// "NYMAN, LISA" -> "Lisa Nyman". Kept for a human follow-up call only.
function contactFromLastFirst(raw: string): string | null {
  const v = s(raw);
  if (!v) return null;
  const m = /^([^,]+),\s*(.+)$/.exec(v);
  return titleCase(m ? `${m[2]} ${m[1]}` : v);
}

export function toWiLead(r: WiChildcareRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const name = titleCase(s(r.FacilityName));
  const city = s(r.City) || null;
  const state = (s(r.State) || 'WI').toUpperCase();
  const location = city ? `${titleCase(city)}, ${state}` : state;
  const licenseId = s(r.FacilityNumber);
  const type = s(r.CategoryType).toUpperCase();
  const typeLabel = WI_TYPE_LABEL[type];
  const phone = formatUsPhone(r.LocationPrimaryPhoneNumber);
  const capacity = toCapacity(s(r.Capacity));
  return {
    sourceKey: `childcare:wi:${licenseId}`,
    name, legalName: null, city: city ? titleCase(city) : null, state, phone, licenseId,
    registryName: WI_CC_REGISTRY, typeLabel,
    contactName: contactFromLastFirst(s(r.LocationContactFullName)),
    location,
    description: describeRegistryLead({ typeLabel, registryName: WI_CC_REGISTRY, location, legalName: null, name, listNoun: LIST_NOUN }),
    signalDetail: `WI DCF ${type.toLowerCase()} provider ${licenseId}${capacity ? `; capacity ${capacity}` : ''}${phone ? `; phone ${phone}` : ''}`,
    adjust: ev.adjust, reasons: ev.reasons,
    email: null, contactSourceUrl: null,
  };
}

// ---- Indiana ----------------------------------------------------------------

export const IN_TYPE_LABEL: Record<string, string> = {
  'Licensed Center': 'licensed child care center',
  'Licensed Home': 'licensed child care home',
};

export interface InChildcareRow {
  facilityNumber: string;
  name: string;
  contact: string; // "Address: 798 NORTH MAIN STREET, GENEVA, IN 46740Phone:    (765) 233-2995" or "Phone: ..." only
  county: string;
  type: string;
  capacity: string;
}

const clean = (h: string) => h.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

// Parses every data table of the listings page. A table is recognised by its header
// row (Facility Number / Facility Name / Contact Information ...), so a layout
// change surfaces as zero rows rather than as wrong columns.
export function parseInListings(html: string): InChildcareRow[] {
  const out: InChildcareRow[] = [];
  for (const t of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const rows = [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
    const head = [...(rows[0] ?? '').matchAll(/<t[hd][\s\S]*?<\/t[hd]>/gi)].map((m) => clean(m[0]).toLowerCase());
    const ix = (label: string) => head.indexOf(label);
    const iNum = ix('facility number'), iName = ix('facility name'), iContact = ix('contact information'), iCounty = ix('county'), iType = ix('provider type'), iCap = ix('capacity');
    if ([iNum, iName, iContact, iCounty, iType].some((i) => i < 0)) continue;
    for (const r of rows.slice(1)) {
      const cells = [...r.matchAll(/<td[\s\S]*?<\/td>/gi)].map((m) => m[0]);
      if (cells.length <= iType) continue;
      // The contact cell keeps its <br>-less "Address: ...Phone: ..." text after tag removal.
      out.push({
        facilityNumber: clean(cells[iNum]), name: clean(cells[iName]), contact: clean(cells[iContact]),
        county: clean(cells[iCounty]), type: clean(cells[iType]), capacity: iCap >= 0 ? clean(cells[iCap]) : '',
      });
    }
  }
  return out;
}

export function parseInContact(contact: string): { phone: string | null; city: string | null; zip: string | null } {
  const pm = /Phone:\s*(\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4})/i.exec(contact);
  const am = /Address:\s*(.*?)(?:Phone:|$)/i.exec(contact);
  let city: string | null = null;
  let zip: string | null = null;
  if (am) {
    // "798 NORTH MAIN STREET, GENEVA, IN 46740"
    const parts = am[1].split(',').map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1] ?? '';
    const sm = /^([A-Z]{2})\s*(\d{5})?/.exec(last);
    if (sm && parts.length >= 2) { city = parts[parts.length - 2] || null; zip = sm[2] ?? null; }
  }
  return { phone: formatUsPhone(pm?.[1] ?? null), city, zip };
}

export function evaluateInRow(r: InChildcareRow): Evaluation {
  if (!IN_TYPE_LABEL[r.type]) return { keep: false, reason: 'provider type not in scope (licensed centers and homes only)' };
  if (!r.name) return { keep: false, reason: 'no facility name' };
  if (!r.facilityNumber) return { keep: false, reason: 'no facility number' };
  if (CHAIN.test(r.name)) return { keep: false, reason: 'national chain, franchise, or large multi-site operator' };
  const { phone } = parseInContact(r.contact);
  if (!phone) return { keep: false, reason: 'no contact detail at all' };
  return { keep: true, ...scoreChildcareRow({ name: r.name, email: null, phone, capacity: toCapacity(r.capacity) }) };
}

export function toInLead(r: InChildcareRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const name = titleCase(r.name);
  const { phone, city } = parseInContact(r.contact);
  // Licensed homes publish no address by statute: the county is the only place name.
  const location = city ? `${titleCase(city)}, IN` : r.county ? `${titleCase(r.county)} County, IN` : 'IN';
  const typeLabel = IN_TYPE_LABEL[r.type];
  const capacity = toCapacity(r.capacity);
  return {
    sourceKey: `childcare:in:${r.facilityNumber.toUpperCase()}`,
    name, legalName: null, city: city ? titleCase(city) : null, state: 'IN', phone,
    licenseId: r.facilityNumber, registryName: IN_CC_REGISTRY, typeLabel, contactName: null, location,
    description: describeRegistryLead({ typeLabel, registryName: IN_CC_REGISTRY, location, legalName: null, name, listNoun: LIST_NOUN }),
    signalDetail: `IN FSSA ${r.type.toLowerCase()} ${r.facilityNumber}${r.county ? `, ${titleCase(r.county)} County` : ''}${capacity ? `; capacity ${capacity}` : ''}${phone ? `; phone ${phone}` : ''}`,
    adjust: ev.adjust, reasons: ev.reasons,
    email: null, contactSourceUrl: null,
  };
}

// ---- network ----------------------------------------------------------------

const WI_FIELDS = 'FacilityNumber,FacilityName,LocationContactFullName,LocationPrimaryPhoneNumber,City,State,CategoryType,Capacity';

export async function fetchWiRows(log: (m: string) => void = () => {}): Promise<WiChildcareRow[]> {
  const out: WiChildcareRow[] = [];
  const page = 1000; // layer maxRecordCount is 2000; stay well under it
  for (let offset = 0; ; offset += page) {
    const qs = new URLSearchParams({ where: '1=1', outFields: WI_FIELDS, returnGeometry: 'false', orderByFields: 'OBJECTID', resultOffset: String(offset), resultRecordCount: String(page), f: 'json' });
    const res = await fetch(`${WI_CC_URL}/query?${qs}`, { headers: { 'User-Agent': DISCOVERY_UA, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`WI child care layer HTTP ${res.status}`);
    const j = (await res.json()) as { features?: { attributes: WiChildcareRow }[]; error?: { message?: string } };
    if (j.error) throw new Error(`WI child care layer: ${j.error.message ?? 'error'}`);
    const feats = j.features ?? [];
    for (const f of feats) out.push(f.attributes);
    log(`wi-childcare: ${out.length} rows`);
    if (feats.length < page) break;
  }
  if (out.length < 500) throw new Error(`WI child care layer returned only ${out.length} rows; layout may have changed`);
  return out;
}

export async function fetchInRows(log: (m: string) => void = () => {}): Promise<InChildcareRow[]> {
  const res = await fetch(IN_CC_URL, { headers: { 'User-Agent': DISCOVERY_UA, Accept: 'text/html' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`IN child care listings HTTP ${res.status}`);
  const rows = parseInListings(await res.text());
  log(`in-childcare: ${rows.length} rows`);
  if (rows.length < 500) throw new Error(`IN child care listings parsed only ${rows.length} rows; layout may have changed`);
  return rows;
}

export async function streamWiChildcareLeads(opts: { isKnown?: (k: string) => boolean; log?: (m: string) => void; rows?: WiChildcareRow[] } = {}): Promise<RegistryResult> {
  const result = emptyResult();
  try {
    const rows = opts.rows ?? (await fetchWiRows(opts.log));
    const seen = new Set<string>();
    for (const r of rows) {
      result.scanned++;
      const ev = evaluateWiRow(r);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      const lead = toWiLead(r, ev);
      if (seen.has(lead.sourceKey)) { reject(result, 'duplicate facility number'); continue; }
      seen.add(lead.sourceKey);
      if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); continue; }
      result.candidates.push(lead);
    }
  } catch (e) {
    result.errors.push(`childcare wi: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

export async function streamInChildcareLeads(opts: { isKnown?: (k: string) => boolean; log?: (m: string) => void; rows?: InChildcareRow[] } = {}): Promise<RegistryResult> {
  const result = emptyResult();
  try {
    const rows = opts.rows ?? (await fetchInRows(opts.log));
    const seen = new Set<string>();
    for (const r of rows) {
      result.scanned++;
      const ev = evaluateInRow(r);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      const lead = toInLead(r, ev);
      if (seen.has(lead.sourceKey)) { reject(result, 'duplicate facility number'); continue; }
      seen.add(lead.sourceKey);
      if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); continue; }
      result.candidates.push(lead);
    }
  } catch (e) {
    result.errors.push(`childcare in: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
