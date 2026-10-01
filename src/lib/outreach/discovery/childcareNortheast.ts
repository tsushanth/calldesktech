import { socrataGet } from './socrata';
import { sleep } from './http';
import { cleanEmail } from './freightFmcsa';
import { scoreChildcareRow, toCapacity as toCapacityInt } from './childcareUs';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';

// Northeast US child care for the `childcare` vertical: five state licensing
// datasets, all free public bulk/API sources. Verified live 2026-09-30:
//
//   nj-childcare  NJDEP GIS layer built from the NJ DCF Office of Licensing list
//                 mapsdep.nj.gov/arcgis/rest/services/Features/Structures/MapServer/4
//                 4,083 active licensed centres, 100% with center_email, 100% phone,
//                 refreshed monthly (download_date 2026-09-09). BEST yield.
//   vt-childcare  data.vermont.gov/ctdw-tmfz   1,048 rows, 100% email, 100% phone.
//   ma-childcare  educationtocareer.data.mass.gov/iyks-y3g6 ("Current Licensed and
//                 Funded EEC Programs", monthly snapshot 2026-09-02) 9,217 rows;
//                 phone ~100%, NO email column.
//   ct-childcare  data.ct.gov/h8mr-dn95  16,248 rows (3,788 ACTIVE), phone 99%, no email.
//   ny-childcare  data.ny.gov/cb42-qumz  16,716 rows, phone 84% (15% are withheld on
//                 purpose: phone_number_omitted='Y'), no email.
//
// US leads, nothing here is on the international hold. Where a dataset has no email
// the lead is phone-first and stageEnrich resolves the website, exactly like TX/PA.
// Free-mail addresses are KEPT (see the FREE-MAIL DECISION in childcareUs.ts).

export type Evaluation = { keep: true; adjust: number; reasons: string[] } | { keep: false; reason: string };

// Same national-chain list as childcareUs.ts (kept local so childcareUs.ts stays untouched).
const CHAIN = /\b(kindercare|knowledge (beginnings|universal)|bright horizons|goddard school|primrose school|la petite academy|childtime|tutor time|learning care group|everbrook|right at school|kids ?r ?kids|sunshine house|cr[eè]me de la cr[eè]me|lightbridge academy|celebree|guidepost montessori|new horizon academy|children'?s lighthouse|cadence education|endeavor schools|the learning experience|nobel learning|childcare network|\bkla schools\b|young scholars academy of|\bymca\b|\bywca\b|boys (and|&) girls club)\b/i;

// MA publishes capacity as "68.00"; childcareUs.toCapacity strips non-digits and would read 6800.
export function toCapacity(raw: string | null | undefined): number | null {
  const n = Math.round(Number(String(raw ?? '').replace(/[^\d.]/g, '')));
  return Number.isFinite(n) && n > 0 ? n : toCapacityInt(raw);
}

function finish(name: string, legal: string | null, email: string | null, phone: string | null, capacity: number | null): Evaluation {
  if (!name) return { keep: false, reason: 'no program name' };
  if (CHAIN.test(`${name} ${legal ?? ''}`)) return { keep: false, reason: 'national chain, franchise, or large multi-site operator' };
  if (!email && !phone) return { keep: false, reason: 'no contact detail at all' };
  return { keep: true, ...scoreChildcareRow({ name, legalName: legal, email, phone, capacity }) };
}

function lead(a: {
  state: string; id: string; rawName: string; legal?: string | null; city: string | null; phone: string | null; email: string | null;
  registry: string; listNoun: string; typeLabel: string; contactName?: string | null; detail: string; sourceUrl: string; ev: { adjust: number; reasons: string[] };
}): RegistryLead {
  const name = titleCase(a.rawName.trim());
  const legalName = a.legal && a.legal.trim().toUpperCase() !== a.rawName.trim().toUpperCase() ? titleCase(a.legal.trim()) : null;
  const location = cityState(a.city, a.state);
  return {
    sourceKey: `childcare:${a.state.toLowerCase()}:${a.id}`,
    name,
    legalName,
    city: a.city ? titleCase(a.city) : null,
    state: a.state,
    phone: a.phone,
    licenseId: a.id,
    registryName: a.registry,
    typeLabel: a.typeLabel,
    contactName: a.contactName?.trim() || null,
    location,
    description: describeRegistryLead({ typeLabel: a.typeLabel, registryName: a.registry, location, legalName, name, listNoun: a.listNoun }),
    signalDetail: `${a.detail}${a.phone ? `; phone ${a.phone}` : ''}`,
    adjust: a.ev.adjust,
    reasons: a.ev.reasons,
    email: a.email,
    contactSourceUrl: a.email ? a.sourceUrl : null,
  };
}

// ---- New Jersey ------------------------------------------------------------

export const NJ_REGISTRY = 'New Jersey Department of Children and Families Office of Licensing';
export const NJ_LAYER_URL = 'https://mapsdep.nj.gov/arcgis/rest/services/Features/Structures/MapServer/4';
export const NJ_URL = 'https://childcareexplorer.njccis.com/portal/';

export interface NjRow {
  center_id?: string | null;
  center_name?: string | null;
  owner?: string | null;
  director?: string | null;
  city?: string | null;
  county?: string | null;
  center_phone?: string | null;
  center_email?: string | null;
  licensed_capacity?: number | string | null;
}

export function evaluateNjRow(r: NjRow): Evaluation {
  if (!(r.center_id ?? '').toString().trim()) return { keep: false, reason: 'no DCF licence number' };
  return finish((r.center_name ?? '').trim(), r.owner ?? null, cleanEmail(r.center_email), formatUsPhone(r.center_phone), toCapacity(String(r.licensed_capacity ?? '')));
}

export function toNjLead(r: NjRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const id = String(r.center_id).trim();
  const email = cleanEmail(r.center_email);
  const cap = toCapacity(String(r.licensed_capacity ?? ''));
  return lead({
    state: 'NJ', id, rawName: (r.center_name ?? ''), legal: r.owner ?? null, city: (r.city ?? '').trim() || null,
    phone: formatUsPhone(r.center_phone), email, registry: NJ_REGISTRY, listNoun: 'licensed child care centre list',
    typeLabel: 'licensed child care center', contactName: r.director, sourceUrl: NJ_URL, ev,
    detail: `NJ DCF licensed child care centre ${id}${r.county ? `, ${titleCase(r.county)} County` : ''}${cap ? `; capacity ${cap}` : ''}`,
  });
}

// ---- Massachusetts ---------------------------------------------------------

export const MA_REGISTRY = 'Massachusetts Department of Early Education and Care';
export const MA_URL = 'https://educationtocareer.data.mass.gov/d/iyks-y3g6';
const MA_LICENSED_OK = new Set(['Current', 'Renewal in progress', 'Regional Enrollment Freeze']);

export interface MaRow {
  provider_number?: string;
  program_name?: string;
  program_umbrella?: string;
  program_city?: string;
  program_phone?: string;
  program_type?: string;
  licensed_funded?: string;
  licensed_provider_status?: string;
  regulatory_status?: string;
  licensed_capacity?: string;
}

const MA_TYPE: Record<string, string> = {
  'Center-based Care': 'licensed child care center',
  'Family Child Care': 'licensed family child care home',
};

export function evaluateMaRow(r: MaRow): Evaluation {
  if ((r.licensed_funded ?? '').trim() !== 'Licensed') return { keep: false, reason: 'funded-only programme (not a licensed provider)' };
  const type = (r.program_type ?? '').trim();
  if (!MA_TYPE[type]) return { keep: false, reason: 'program type not in scope' };
  if (!MA_LICENSED_OK.has((r.licensed_provider_status ?? '').trim())) return { keep: false, reason: 'licence expired or status unknown' };
  if (type === 'Family Child Care' && (r.regulatory_status ?? '').trim() !== 'Active') return { keep: false, reason: 'not active' };
  if (!(r.provider_number ?? '').trim()) return { keep: false, reason: 'no provider number' };
  return finish((r.program_name ?? '').trim(), r.program_umbrella ?? null, null, formatUsPhone(r.program_phone), toCapacity(r.licensed_capacity));
}

export function toMaLead(r: MaRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const id = (r.provider_number ?? '').trim().toUpperCase();
  const cap = toCapacity(r.licensed_capacity);
  return lead({
    state: 'MA', id, rawName: r.program_name ?? '', legal: null, city: (r.program_city ?? '').trim() || null,
    phone: formatUsPhone(r.program_phone), email: null, registry: MA_REGISTRY, listNoun: 'licensed programs data',
    typeLabel: MA_TYPE[(r.program_type ?? '').trim()], sourceUrl: MA_URL, ev,
    detail: `MA EEC ${(r.program_type ?? '').trim()} provider ${id}${cap ? `; capacity ${cap}` : ''}`,
  });
}

// ---- Connecticut -----------------------------------------------------------

export const CT_REGISTRY = 'Connecticut Office of Early Childhood';
export const CT_URL = 'https://data.ct.gov/d/h8mr-dn95';
const CT_TYPE: Record<string, string> = {
  'Child Care Center': 'licensed child care center',
  'Group Child Care Home': 'licensed group child care home',
  'Family Child Care Home': 'licensed family child care home',
};

export interface CtRow {
  licensenumber?: string;
  name?: string;
  licensetype?: string;
  status?: string;
  city?: string;
  phone?: string;
  regularcapacity?: string;
}

export function evaluateCtRow(r: CtRow): Evaluation {
  const type = (r.licensetype ?? '').trim();
  if (!CT_TYPE[type]) return { keep: false, reason: 'licence type not in scope (youth camps and exempt programmes skipped)' };
  if ((r.status ?? '').trim().toUpperCase() !== 'ACTIVE') return { keep: false, reason: 'licence not active' };
  if (!(r.licensenumber ?? '').trim()) return { keep: false, reason: 'no licence number' };
  return finish((r.name ?? '').trim(), null, null, formatUsPhone(r.phone), toCapacity(r.regularcapacity));
}

export function toCtLead(r: CtRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const id = (r.licensenumber ?? '').trim().toUpperCase();
  const cap = toCapacity(r.regularcapacity);
  return lead({
    state: 'CT', id, rawName: r.name ?? '', legal: null, city: (r.city ?? '').trim() || null,
    phone: formatUsPhone(r.phone), email: null, registry: CT_REGISTRY, listNoun: 'child care licensing data',
    typeLabel: CT_TYPE[(r.licensetype ?? '').trim()], sourceUrl: CT_URL, ev,
    detail: `CT ${(r.licensetype ?? '').trim()} licence ${id}${cap ? `; capacity ${cap}` : ''}`,
  });
}

// ---- New York --------------------------------------------------------------

export const NY_REGISTRY = 'New York State Office of Children and Family Services';
export const NY_URL = 'https://data.ny.gov/d/cb42-qumz';
// DCC centre, GFDC group family, FDC family, SACC school-age. Statuses License and
// Registration are both lawful operating states; Suspended and Pending Revocation are not.
const NY_TYPE: Record<string, string> = {
  DCC: 'child care center',
  GFDC: 'group family child care home',
  FDC: 'family child care home',
  SACC: 'school-age child care program',
};

export interface NyRow {
  facility_id?: string;
  facility_name?: string;
  provider_name?: string;
  program_type?: string;
  facility_status?: string;
  city?: string;
  county?: string;
  phone_number?: string;
  phone_number_omitted?: string;
  total_capacity?: string;
}

export function nyTypeLabel(r: NyRow): string | null {
  const base = NY_TYPE[(r.program_type ?? '').trim()];
  if (!base) return null;
  const st = (r.facility_status ?? '').trim();
  return st === 'License' ? `licensed ${base}` : st === 'Registration' ? `registered ${base}` : null;
}

export function evaluateNyRow(r: NyRow): Evaluation {
  if (!NY_TYPE[(r.program_type ?? '').trim()]) return { keep: false, reason: 'program type not in scope' };
  if (!nyTypeLabel(r)) return { keep: false, reason: 'not currently licensed or registered (suspended / revocation pending)' };
  if (!(r.facility_id ?? '').trim()) return { keep: false, reason: 'no facility id' };
  // The state withholds some home-based providers' phones on request; honour that.
  const phone = (r.phone_number_omitted ?? '').trim().toUpperCase() === 'Y' ? null : formatUsPhone(r.phone_number);
  return finish((r.facility_name ?? '').trim(), r.provider_name ?? null, null, phone, toCapacity(r.total_capacity));
}

export function toNyLead(r: NyRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const id = (r.facility_id ?? '').trim();
  const phone = (r.phone_number_omitted ?? '').trim().toUpperCase() === 'Y' ? null : formatUsPhone(r.phone_number);
  const cap = toCapacity(r.total_capacity);
  return lead({
    state: 'NY', id, rawName: r.facility_name ?? '', legal: r.provider_name ?? null, city: (r.city ?? '').trim() || null,
    phone, email: null, registry: NY_REGISTRY, listNoun: 'child care regulated programs data',
    typeLabel: nyTypeLabel(r) as string, sourceUrl: NY_URL, ev,
    detail: `NY OCFS ${(r.program_type ?? '').trim()} ${(r.facility_status ?? '').trim().toLowerCase()} ${id}${r.county ? `, ${titleCase(r.county)} County` : ''}${cap ? `; capacity ${cap}` : ''}`,
  });
}

// ---- Vermont ---------------------------------------------------------------

export const VT_REGISTRY = 'Vermont Department for Children and Families Child Development Division';
export const VT_URL = 'https://data.vermont.gov/d/ctdw-tmfz';

export interface VtRow {
  license_id?: string;
  provider_name?: string;
  provider_town?: string;
  license_type?: string;
  provider_program_type?: string;
  provider_referral_status?: string;
  phone_number?: string;
  email_address?: string;
  total_licensed_capacity?: string;
}

export function vtTypeLabel(r: VtRow): string | null {
  const t = (r.license_type ?? '').trim();
  const p = (r.provider_program_type ?? '').trim();
  if (t === 'Registered Home') return 'registered family child care home';
  if (t === 'Licensed Provider') return /afterschool/i.test(p) ? 'licensed afterschool child care program' : /fcch/i.test(p) ? 'licensed family child care home' : 'licensed child care program';
  return null;
}

export function evaluateVtRow(r: VtRow): Evaluation {
  if (!vtTypeLabel(r)) return { keep: false, reason: 'licence type not in scope' };
  if ((r.provider_referral_status ?? '').trim().toLowerCase() === 'inactive') return { keep: false, reason: 'inactive' };
  if (!(r.license_id ?? '').trim()) return { keep: false, reason: 'no licence id' };
  return finish((r.provider_name ?? '').trim(), null, cleanEmail(r.email_address), formatUsPhone(r.phone_number), toCapacity(r.total_licensed_capacity));
}

export function toVtLead(r: VtRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const id = (r.license_id ?? '').trim();
  const cap = toCapacity(r.total_licensed_capacity);
  return lead({
    state: 'VT', id, rawName: r.provider_name ?? '', legal: null, city: (r.provider_town ?? '').trim() || null,
    phone: formatUsPhone(r.phone_number), email: cleanEmail(r.email_address), registry: VT_REGISTRY, listNoun: 'child care provider data',
    typeLabel: vtTypeLabel(r) as string, sourceUrl: VT_URL, ev,
    detail: `VT CDD ${(r.provider_program_type ?? '').trim()} licence ${id}${cap ? `; capacity ${cap}` : ''}`,
  });
}

// ---- network ---------------------------------------------------------------

export type NeChildcareSource = 'nj' | 'ma' | 'ct' | 'ny' | 'vt';
export const NE_CHILDCARE_SOURCES: readonly NeChildcareSource[] = ['nj', 'ma', 'ct', 'ny', 'vt'];

interface SocrataDef {
  host: string; dataset: string; select: string; where: string; limit: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluate: (r: any) => Evaluation;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toLead: (r: any, ev: { adjust: number; reasons: string[] }) => RegistryLead;
}

const SOCRATA: Record<Exclude<NeChildcareSource, 'nj'>, SocrataDef> = {
  ma: {
    host: 'educationtocareer.data.mass.gov', dataset: 'iyks-y3g6', limit: '12000',
    select: 'provider_number,program_name,program_umbrella,program_city,program_phone,program_type,licensed_funded,licensed_provider_status,regulatory_status,licensed_capacity',
    where: "licensed_funded='Licensed'", evaluate: evaluateMaRow, toLead: toMaLead,
  },
  ct: {
    host: 'data.ct.gov', dataset: 'h8mr-dn95', limit: '20000',
    select: 'licensenumber,name,licensetype,status,city,phone,regularcapacity',
    where: "status='ACTIVE'", evaluate: evaluateCtRow, toLead: toCtLead,
  },
  ny: {
    host: 'data.ny.gov', dataset: 'cb42-qumz', limit: '20000',
    select: 'facility_id,facility_name,provider_name,program_type,facility_status,city,county,phone_number,phone_number_omitted,total_capacity',
    where: "facility_status in('License','Registration')", evaluate: evaluateNyRow, toLead: toNyLead,
  },
  vt: {
    host: 'data.vermont.gov', dataset: 'ctdw-tmfz', limit: '3000',
    select: 'license_id,provider_name,provider_town,license_type,provider_program_type,provider_referral_status,phone_number,email_address,total_licensed_capacity',
    where: "provider_referral_status != 'Inactive' OR provider_referral_status IS NULL", evaluate: evaluateVtRow, toLead: toVtLead,
  },
};

// ArcGIS REST pagination (maxRecordCount 2000), polite and retrying.
export async function fetchNjRows(log: (m: string) => void = () => {}): Promise<NjRow[]> {
  const out: NjRow[] = [];
  for (let offset = 0; offset < 20000; offset += 2000) {
    const qs = new URLSearchParams({
      where: '1=1', outFields: 'center_id,center_name,owner,director,city,county,center_phone,center_email,licensed_capacity',
      returnGeometry: 'false', orderByFields: 'OBJECTID', resultOffset: String(offset), resultRecordCount: '2000', f: 'json',
    });
    let page: NjRow[] | null = null;
    let delay = 2000;
    for (let attempt = 0; attempt < 4 && !page; attempt++) {
      try {
        const res = await fetch(`${NJ_LAYER_URL}/query?${qs}`, { headers: { Accept: 'application/json', 'User-Agent': 'calldesk-outreach-research/1.0 (+https://calldesk.tech)' } });
        const body = (await res.json()) as { features?: { attributes: NjRow }[]; error?: { message?: string } };
        if (!res.ok || body.error || !body.features) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
        page = body.features.map((f) => f.attributes);
      } catch (e) {
        log(`nj arcgis retry in ${delay}ms (${e instanceof Error ? e.message : String(e)})`);
        await sleep(delay);
        delay *= 2;
      }
    }
    if (!page) throw new Error('nj arcgis failed after retries');
    out.push(...page);
    if (page.length < 2000) break;
  }
  return out;
}

// Every candidate a source has, same signature as childcareUs.allChildcareLeads so
// wiring is one line in pipeline.ts's bulk table (not done here).
export async function allNeChildcareLeads(
  source: NeChildcareSource, opts: { isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const log = opts.log ?? (() => {});
  const result = emptyResult();
  try {
    let rows: Record<string, unknown>[];
    let evaluate: (r: never) => Evaluation;
    let toLead: (r: never, ev: { adjust: number; reasons: string[] }) => RegistryLead;
    if (source === 'nj') {
      rows = (await fetchNjRows(log)) as Record<string, unknown>[];
      evaluate = evaluateNjRow as (r: never) => Evaluation; toLead = toNjLead as typeof toLead;
    } else {
      const def = SOCRATA[source];
      rows = await socrataGet<Record<string, unknown>>(def.host, def.dataset, { $select: def.select, $where: def.where, $limit: def.limit, $order: ':id' }, log);
      evaluate = def.evaluate; toLead = def.toLead;
    }
    if (!rows.length) throw new Error('no rows returned');
    result.scanned = rows.length;
    const seen = new Set<string>();
    for (const r of rows) {
      const ev = evaluate(r as never);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      const l = toLead(r as never, ev);
      // CT in particular lists one licence under several contact rows.
      if (seen.has(l.sourceKey)) { reject(result, 'duplicate licence row'); continue; }
      seen.add(l.sourceKey);
      if (opts.isKnown?.(l.sourceKey)) { reject(result, 'already known'); continue; }
      result.candidates.push(l);
    }
  } catch (e) {
    result.errors.push(`childcare ${source}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
