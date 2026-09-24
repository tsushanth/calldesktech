import { sleep as politeSleep, DISCOVERY_UA } from './http';
import { US_METROS } from './verticalSearch';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';

// Dental discovery from the CMS NPPES NPI Registry public API (no key, no
// licence gate). enumeration_type=NPI-2 returns ORGANISATIONS, i.e. practices
// rather than individual dentists, which is the record we want.
//
// Two caveats drive the design:
//  * `skip` is silently clamped by the API: past roughly 1,200 rows a query just
//    returns the same tail, so paging deep is pointless. Instead we slice by
//    CITY (US_METROS from verticalSearch.ts) and rotate the city per run.
//  * Organisational subparts (`organizational_subpart: "YES"`) are departments of
//    a larger organisation, not independent practices, so they are skipped.
// There is no email or website in NPPES, so stageEnrich resolves the site.

export const NPPES_URL = 'https://npiregistry.cms.hhs.gov/api/';
const NPPES_REGISTRY = 'CMS National Plan and Provider Enumeration System (NPPES)';
const NPPES_LIST_NOUN = 'NPI registry';
const TYPE_LABEL = 'dental practice with an organisational NPI';

export interface NppesAddress {
  address_purpose?: string;
  address_1?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  telephone_number?: string;
}
export interface NppesResult {
  number?: string | number;
  enumeration_type?: string;
  basic?: { organization_name?: string; status?: string; organizational_subpart?: string };
  addresses?: NppesAddress[];
  taxonomies?: { desc?: string; primary?: boolean }[];
}

// Dental support organisations and corporate chains. The vertical's
// hostExclusions in verticalSearch.ts covers the same groups at the domain level;
// this is the name-level equivalent for registry rows, which have no domain.
const DSO = /\b(aspen dental|heartland dental|pacific dental|western dental|smile brands|monarch dental|clearchoice|affordable dentures|sonrava|dental care alliance|great expressions|kool smiles|benevis|risas dental|comfort dental|gentle dental|bright now|midwest dental|mortenson dental|dentalone|perfect teeth|smile ?direct|dso\b|dental support organization)\b/i;
// Institutions: universities, hospitals, health systems, county clinics.
const INSTITUTION = /\b(university|college|school of dentistry|hospital|health systems?|medical center|county|city of|department of|federally qualified|community health center|va\b|army|navy|air force)\b/i;

export function locationAddress(r: NppesResult): NppesAddress | null {
  const addrs = r.addresses ?? [];
  return addrs.find((a) => (a.address_purpose ?? '').toUpperCase() === 'LOCATION') ?? addrs[0] ?? null;
}

export type Evaluation = { keep: true; adjust: number; reasons: string[] } | { keep: false; reason: string };

export function evaluateNppesRow(r: NppesResult): Evaluation {
  const npi = String(r.number ?? '').trim();
  const name = (r.basic?.organization_name ?? '').trim();
  if (!npi || !name) return { keep: false, reason: 'missing NPI or organisation name' };
  if (r.enumeration_type && r.enumeration_type !== 'NPI-2') return { keep: false, reason: 'not an organisation NPI' };
  if ((r.basic?.status ?? 'A').toUpperCase() !== 'A') return { keep: false, reason: 'NPI not active' };
  if ((r.basic?.organizational_subpart ?? 'NO').toUpperCase() === 'YES') return { keep: false, reason: 'organisational subpart, not an independent practice' };
  if (DSO.test(name)) return { keep: false, reason: 'DSO or corporate dental chain name' };
  if (INSTITUTION.test(name)) return { keep: false, reason: 'institution (university/hospital/government)' };
  const taxo = (r.taxonomies ?? []).map((t) => t.desc ?? '').join(' ');
  if (taxo && !/dent|oral|orthodont|periodont|endodont|prosthodont/i.test(taxo)) return { keep: false, reason: 'taxonomy is not dental' };
  const addr = locationAddress(r);
  if (!addr?.city) return { keep: false, reason: 'no practice location address' };

  const reasons: string[] = [];
  let adjust = 0;
  if (!formatUsPhone(addr.telephone_number)) { adjust -= 5; reasons.push('-5: no usable phone in the registry record'); }
  if (/general practice|family dent/i.test(taxo)) { adjust += 3; reasons.push('+3: general/family dentistry taxonomy (phone-driven new-patient demand)'); }
  return { keep: true, adjust, reasons };
}

export function toNppesLead(r: NppesResult, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const npi = String(r.number ?? '').trim();
  const addr = locationAddress(r) as NppesAddress;
  const name = titleCase((r.basic?.organization_name as string).replace(/\s+/g, ' ').trim());
  const city = addr.city?.trim() || null;
  const state = (addr.state ?? '').trim().toUpperCase() || null;
  const location = cityState(city, state);
  const phone = formatUsPhone(addr.telephone_number);
  return {
    sourceKey: `dental:npi:${npi}`,
    name, legalName: null, city: city ? titleCase(city) : null, state, phone, licenseId: npi,
    registryName: NPPES_REGISTRY, typeLabel: TYPE_LABEL, contactName: null, location,
    description: describeRegistryLead({ typeLabel: TYPE_LABEL, registryName: NPPES_REGISTRY, location, legalName: null, name, listNoun: NPPES_LIST_NOUN }),
    signalDetail: `NPPES organisation NPI ${npi} (dental taxonomy)${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust, reasons: ev.reasons,
  };
}

// ---- network ---------------------------------------------------------------

// The API caps `limit` at 200 and clamps `skip` past ~1,200, so we never ask for
// more than one page per city and rotate cities instead.
const PAGE = 200;
const DAY_MS = 86_400_000;

export function citiesForRun(now: Date, count: number, metros: string[] = US_METROS): { city: string; state: string }[] {
  const day = Math.floor(now.getTime() / DAY_MS);
  const out: { city: string; state: string }[] = [];
  for (let i = 0; i < Math.min(count, metros.length); i++) {
    const [city, state] = metros[(day * count + i) % metros.length].split(',').map((s) => s.trim());
    out.push({ city, state });
  }
  return out;
}

export async function fetchNppesCity(city: string, state: string, timeoutMs = 20_000): Promise<NppesResult[]> {
  const qs = new URLSearchParams({
    version: '2.1', enumeration_type: 'NPI-2', taxonomy_description: 'Dentist',
    state, city, limit: String(PAGE),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${NPPES_URL}?${qs}`, { headers: { 'User-Agent': DISCOVERY_UA, Accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) throw new Error(`NPPES HTTP ${res.status}`);
    const body = (await res.json()) as { results?: NppesResult[]; Errors?: { description?: string }[] };
    if (body.Errors?.length) throw new Error(`NPPES error: ${body.Errors[0]?.description ?? 'unknown'}`);
    return body.results ?? [];
  } finally {
    clearTimeout(timer);
  }
}

// Walks a few metros per run (one request each, spaced apart), skipping practices
// we already hold, until `max` candidates are collected.
export async function findDentalNppesCandidates(
  max: number,
  opts: { now?: Date; cities?: { city: string; state: string }[]; isKnown?: (sourceKey: string) => boolean; fetchCity?: typeof fetchNppesCity; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();
  const fetchCity = opts.fetchCity ?? fetchNppesCity;
  const cities = opts.cities ?? citiesForRun(now, 3);
  for (const { city, state } of cities) {
    if (result.candidates.length >= max) break;
    try {
      const rows = await fetchCity(city, state);
      result.scanned += rows.length;
      for (const r of rows) {
        if (result.candidates.length >= max) break;
        if (opts.isKnown?.(`dental:npi:${String(r.number ?? '').trim()}`)) { reject(result, 'already known'); continue; }
        const ev = evaluateNppesRow(r);
        if (!ev.keep) { reject(result, ev.reason); continue; }
        result.candidates.push(toNppesLead(r, ev));
      }
    } catch (e) {
      result.errors.push(`dental nppes ${city}, ${state}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await politeSleep(1000);
  }
  return result;
}
