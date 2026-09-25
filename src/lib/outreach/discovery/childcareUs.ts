import { socrataGet } from './socrata';
import { cleanEmail, isFreeMail } from './freightFmcsa';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';

// US child care ingestion for the `childcare` vertical: three state licensing
// datasets, all Socrata JSON, all publishing a contact email on most rows
// (verified live 2026-09-24):
//
//   tx-childcare  data.texas.gov/bc5r-88dy  14,971 rows total
//                 operation_status='Y' + email_address present, by operation_type:
//                   Licensed Center            6,266   KEPT
//                   Licensed Child-Care Home     857   KEPT
//                   Registered Child-Care Home   656   skipped (see below)
//                   Listed Family Home           260   skipped ('Listed' is a
//                     registration, not a licence: no minimum standards enforced)
//                   General Residential Op.      239   skipped (residential care
//                     for children in placement, not a daycare)
//                   Child Placing Agency         152   skipped (adoption/foster
//                     placing agency, not a daycare)
//                 -> pool 7,123. "Registered" homes are skipped with "Listed"
//                 because the brief asked for centres and LICENSED homes only.
//
//   wa-childcare  data.wa.gov/was8-3ni8    3,167 rows, 3,160 Active, 3,151 with
//                 primarycontactemail. Types (Active): CHILD CARE CENTER 2,501,
//                 SCHOOL-AGE PROGRAM 631, OUTDOOR NATURE BASED PROGRAM 28 — all
//                 three are DCYF-licensed programmes that take parent calls, so
//                 all three are kept. NOTE: primarycontactphonenumber is nearly
//                 empty — 2,915 of the 3,160 active rows omit it — so most WA
//                 leads carry an email but no phone. That is a limitation of the
//                 dataset, not a parsing bug, and it costs nothing here because
//                 the email alone makes the lead contactable.
//
//   pa-childcare  data.pa.gov/ajn5-kaxt    7,455 rows, 6,916 with facility_email.
//                 provider_type: Child Care Center 4,995, Family Child Care Home
//                 958, Group Child Care Home 585 — all KEPT; "Other" (917) is
//                 skipped because those rows carry license_number 'N/A' and no
//                 provider type we can describe accurately.
//
// US leads, so nothing here is on the international hold (see registryCommon).
//
// ---- THE FREE-MAIL DECISION -------------------------------------------------
// Child care is unlike the other registry verticals: 2,955 of the 7,123 usable
// Texas rows (41%) publish a gmail/yahoo/aol/hotmail address, because a small
// centre or a home daycare genuinely runs on one. The CA CDPH source drops a
// free-mail address entirely (`usable = !isFreeMail(email) ? email : null`),
// which here would throw away roughly two in five of the best-fitting,
// smallest, most owner-run leads — exactly the population this vertical is for.
//
// So childcare KEEPS the free-mail address as the contact and lets
// pipeline.registryLeadRow do the rest: it sets contact_email/contact_status
// 'found' from `email`, and computes `domain` as null for a free-mail address
// (`email && !isFreeMail(email) ? email.split('@')[1] : null`). That is the
// behaviour the brief describes, and it is already centralised there, so this
// source sets no `domain` of its own except from a published website. A
// free-mail lead is scored down (-8) but still reachable; a business-domain
// lead is scored up (+5) and carries a verifiable domain.
// -----------------------------------------------------------------------------

export const TX_HOST = 'data.texas.gov';
export const TX_DATASET = 'bc5r-88dy';
export const TX_REGISTRY = 'Texas Health and Human Services';
export const TX_DATASET_URL = 'https://data.texas.gov/d/bc5r-88dy';

export const WA_HOST = 'data.wa.gov';
export const WA_DATASET = 'was8-3ni8';
export const WA_REGISTRY = 'Washington State Department of Children, Youth & Families';
export const WA_DATASET_URL = 'https://data.wa.gov/d/was8-3ni8';

export const PA_HOST = 'data.pa.gov';
export const PA_DATASET = 'ajn5-kaxt';
export const PA_REGISTRY = 'Pennsylvania Department of Human Services';
export const PA_DATASET_URL = 'https://data.pa.gov/d/ajn5-kaxt';

const LIST_NOUN_TX = 'licensing data';
const LIST_NOUN_WA = 'licensing data';
const LIST_NOUN_PA = 'child care provider data';

// National child care chains, franchise brands, and the large multi-site
// non-profits that run a big share of licensed school-age care. A hit is a hard
// skip: all of them are head-office-run with a central switchboard or booking
// team, so they are not worth a per-run slot at all. (products.ts's
// scoreVocabulary also marks them down, catching anything this list misses.)
//
// This is not a long tail. In Washington's 3,160 active rows it removes 1,020
// (32%): YMCA 576, Right At School 206, Boys & Girls Club 80, KinderCare 69,
// Bright Horizons 32, and the rest in ones and tens (measured live 2026-09-24).
const CHAIN = /\b(kindercare|knowledge (beginnings|universal)|bright horizons|goddard school|primrose school|la petite academy|childtime|tutor time|learning care group|everbrook|right at school|kids ?r ?kids|sunshine house|cr[eè]me de la cr[eè]me|lightbridge academy|celebree|guidepost montessori|new horizon academy|children'?s lighthouse|cadence education|endeavor schools|the learning experience|nobel learning|childcare network|\bkla schools\b|young scholars academy of|\bymca\b|\bywca\b|boys (and|&) girls club)\b/i;

// Not an owner-run business making its own decision about its phones: a public
// school district programme, a Head Start grantee, a municipal department. Kept
// but marked down rather than skipped — some are small and independent in
// practice, and the description stays factual either way.
const INSTITUTIONAL = /\b(head start|early head start|school district|\bisd\b|\bsd\b elementary|elementary school|middle school|high school|public schools?|board of education|county of|city of|university|college|community action|housing authority|department of)\b/i;

export type Evaluation = { keep: true; adjust: number; reasons: string[] } | { keep: false; reason: string };

// Shared scoring for all three states: the contact detail published, the chain /
// institutional signals, and the licensed capacity where the dataset has one.
// `capacity` is null when the dataset does not publish a usable number.
export function scoreChildcareRow(a: { name: string; legalName?: string | null; email: string | null; phone: string | null; capacity: number | null }): { adjust: number; reasons: string[] } {
  let adjust = 0;
  const reasons: string[] = [];
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };
  const names = `${a.name} ${a.legalName ?? ''}`;

  if (INSTITUTIONAL.test(names)) add(-15, 'school district, Head Start, or other institutional programme rather than an owner-run centre');
  if (!a.email) add(-10, 'no contact email in the licensing data');
  else if (isFreeMail(a.email)) add(-8, 'contact is a free-mail address (common for a small or home-based centre; no business domain to verify)');
  else add(5, 'business-domain contact email published in the licensing data');
  if (!a.phone) add(-5, 'no usable phone in the licensing record');
  // Capacity is the only size signal these datasets publish. A very small
  // licensed capacity is a home or micro-centre (the best fit: no front desk at
  // all); a very large one is a multi-room centre with dedicated office staff.
  if (a.capacity !== null && a.capacity > 0) {
    if (a.capacity <= 12) add(6, 'very small licensed capacity (home-based or micro-centre, no front desk)');
    else if (a.capacity <= 60) add(3, 'small licensed capacity');
    else if (a.capacity >= 200) add(-8, 'large licensed capacity (likely dedicated office staff)');
  }
  return { adjust, reasons };
}

export function toCapacity(raw: string | null | undefined): number | null {
  const n = Number(String(raw ?? '').replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// "www.sproutstartacademy.com" / "http://x.com/about" -> "sproutstartacademy.com".
// Null for anything that is not a plain hostname (the datasets contain email
// addresses, Facebook pages and free text in this column).
export function toDomain(raw: string | null | undefined): string | null {
  let v = String(raw ?? '').trim().toLowerCase();
  if (!v || v.includes('@') || v.includes(' ')) return null;
  v = v.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) || v.length > 100) return null;
  // A social or listing page is not the business's own site.
  if (/(facebook|instagram|twitter|x)\.com$|linkedin\.com$|yelp\.com$|wixsite\.com$|weebly\.com$|blogspot\.com$/.test(v)) return null;
  return v;
}

// ---- Texas -----------------------------------------------------------------

// The only two operation_types kept: centres and LICENSED homes.
export const TX_TYPES = ['Licensed Center', 'Licensed Child-Care Home'] as const;
const TX_TYPE_SET: ReadonlySet<string> = new Set(TX_TYPES);
// Exactly the wording the brief requires, and true of both kept types.
const TX_TYPE_LABEL = 'licensed child care operation';

export interface TxChildcareRow {
  operation_number?: string;
  operation_name?: string;
  operation_type?: string;
  operation_status?: string;
  temporarily_closed?: string;
  phone_number?: string;
  email_address?: string;
  website_address?: string;
  administrator_director_name?: string;
  address_line?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  county?: string;
  total_capacity?: string;
}

export function evaluateTxRow(r: TxChildcareRow): Evaluation {
  if (!TX_TYPE_SET.has((r.operation_type ?? '').trim())) return { keep: false, reason: 'operation type not in scope (centres and licensed homes only)' };
  if ((r.operation_status ?? '').trim().toUpperCase() !== 'Y') return { keep: false, reason: 'operation not active' };
  if ((r.temporarily_closed ?? '').trim().toUpperCase() === 'YES') return { keep: false, reason: 'temporarily closed' };
  const name = (r.operation_name ?? '').trim();
  if (!name) return { keep: false, reason: 'no operation name' };
  if (!(r.operation_number ?? '').trim()) return { keep: false, reason: 'no operation number' };
  if (CHAIN.test(name)) return { keep: false, reason: 'national chain, franchise, or large multi-site operator' };
  const email = cleanEmail(r.email_address);
  const phone = formatUsPhone(r.phone_number);
  if (!email && !phone) return { keep: false, reason: 'no contact detail at all' };
  return { keep: true, ...scoreChildcareRow({ name, email, phone, capacity: toCapacity(r.total_capacity) }) };
}

export function toTxLead(r: TxChildcareRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const name = titleCase((r.operation_name ?? '').trim());
  const city = (r.city ?? '').trim() || null;
  const location = cityState(city, 'TX');
  const licenseId = (r.operation_number ?? '').trim();
  const phone = formatUsPhone(r.phone_number);
  const email = cleanEmail(r.email_address);
  const domain = toDomain(r.website_address);
  const capacity = toCapacity(r.total_capacity);
  return {
    sourceKey: `childcare:tx:${licenseId}`,
    name,
    legalName: null,
    city: city ? titleCase(city) : null,
    state: 'TX',
    phone,
    licenseId,
    registryName: TX_REGISTRY,
    typeLabel: TX_TYPE_LABEL,
    // The administrator/director is a named individual in a public record. Kept
    // in signals.registry for a human follow-up call only; registryLeadRow never
    // puts contactName in a draft.
    contactName: (r.administrator_director_name ?? '').trim() || null,
    location,
    description: describeRegistryLead({ typeLabel: TX_TYPE_LABEL, registryName: TX_REGISTRY, location, legalName: null, name, listNoun: LIST_NOUN_TX }),
    signalDetail: `TX HHSC ${(r.operation_type ?? '').trim()} permit ${licenseId}${r.county ? `, ${titleCase(r.county)} County` : ''}${capacity ? `; capacity ${capacity}` : ''}${phone ? `; phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email,
    contactSourceUrl: email ? TX_DATASET_URL : null,
    domain,
  };
}

// ---- Washington ------------------------------------------------------------

export const WA_TYPE_LABEL: Record<string, string> = {
  'CHILD CARE CENTER': 'licensed child care center',
  'SCHOOL-AGE PROGRAM': 'licensed school-age child care program',
  'OUTDOOR NATURE BASED PROGRAM': 'licensed outdoor nature-based child care program',
};

export interface WaChildcareRow {
  sspsprovidernumber?: string;
  famlinkid?: string;
  wacompassid?: string;
  providername?: string;
  doingbusinessas?: string;
  facilitytypegeneric?: string;
  latestoperatingstatus?: string;
  licensecapacity?: string;
  primarycontactpersonname?: string;
  primarycontactphonenumber?: string;
  primarycontactemail?: string;
  physicalstreetaddress?: string;
  physicalcity?: string;
  physicalstate?: string;
  physicalcounty?: string;
}

export function waLicenseId(r: WaChildcareRow): string {
  return ((r.sspsprovidernumber ?? '').trim() || (r.famlinkid ?? '').trim() || (r.wacompassid ?? '').trim()).toUpperCase();
}

export function evaluateWaRow(r: WaChildcareRow): Evaluation {
  const type = (r.facilitytypegeneric ?? '').trim().toUpperCase();
  if (!WA_TYPE_LABEL[type]) return { keep: false, reason: 'facility type not in scope' };
  if ((r.latestoperatingstatus ?? '').trim().toLowerCase() !== 'active') return { keep: false, reason: 'not active' };
  // The DBA is the trading name and is what a parent would recognise.
  const name = ((r.doingbusinessas ?? '').trim() || (r.providername ?? '').trim());
  if (!name) return { keep: false, reason: 'no provider name' };
  if (!waLicenseId(r)) return { keep: false, reason: 'no provider id' };
  if (CHAIN.test(`${name} ${r.providername ?? ''}`)) return { keep: false, reason: 'national chain, franchise, or large multi-site operator' };
  const email = cleanEmail(r.primarycontactemail);
  const phone = formatUsPhone(r.primarycontactphonenumber);
  if (!email && !phone) return { keep: false, reason: 'no contact detail at all' };
  return { keep: true, ...scoreChildcareRow({ name, legalName: r.providername, email, phone, capacity: toCapacity(r.licensecapacity) }) };
}

export function toWaLead(r: WaChildcareRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const raw = ((r.doingbusinessas ?? '').trim() || (r.providername ?? '').trim());
  const name = titleCase(raw);
  const provider = (r.providername ?? '').trim();
  const legalName = provider && provider.toUpperCase() !== raw.toUpperCase() ? titleCase(provider) : null;
  const city = (r.physicalcity ?? '').trim() || null;
  const location = cityState(city, (r.physicalstate ?? '').trim() || 'WA');
  const licenseId = waLicenseId(r);
  const phone = formatUsPhone(r.primarycontactphonenumber);
  const email = cleanEmail(r.primarycontactemail);
  const type = (r.facilitytypegeneric ?? '').trim().toUpperCase();
  const typeLabel = WA_TYPE_LABEL[type];
  const capacity = toCapacity(r.licensecapacity);
  return {
    sourceKey: `childcare:wa:${licenseId}`,
    name,
    legalName,
    city: city ? titleCase(city) : null,
    state: 'WA',
    phone,
    licenseId,
    registryName: WA_REGISTRY,
    typeLabel,
    contactName: (r.primarycontactpersonname ?? '').trim() || null,
    location,
    description: describeRegistryLead({ typeLabel, registryName: WA_REGISTRY, location, legalName, name, listNoun: LIST_NOUN_WA }),
    signalDetail: `WA DCYF ${type.toLowerCase()} licence ${licenseId}${r.physicalcounty ? `, ${titleCase(r.physicalcounty)} County` : ''}${capacity ? `; capacity ${capacity}` : ''}${phone ? `; phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email,
    contactSourceUrl: email ? WA_DATASET_URL : null,
  };
}

// ---- Pennsylvania ----------------------------------------------------------

export const PA_TYPE_LABEL: Record<string, string> = {
  'Child Care Center': 'certified child care center',
  'Family Child Care Home': 'certified family child care home',
  'Group Child Care Home': 'certified group child care home',
};

export interface PaChildcareRow {
  master_provider_index?: string;
  mpi_id?: string;
  mpi_location_id?: string;
  provider_type?: string;
  facility_name?: string;
  facility_phone?: string;
  facility_email?: string;
  facility_city?: string;
  facility_county?: string;
  facility_zip_code?: string;
  legal_entity_name?: string;
  license_number?: string;
  capacity?: string;
  star_level?: string;
}

export function paLicenseId(r: PaChildcareRow): string {
  const mpi = (r.master_provider_index ?? '').trim();
  if (mpi) return mpi.toUpperCase();
  const id = (r.mpi_id ?? '').trim();
  const loc = (r.mpi_location_id ?? '').trim();
  return id ? (loc ? `${id}-${loc}` : id).toUpperCase() : '';
}

export function evaluatePaRow(r: PaChildcareRow): Evaluation {
  const type = (r.provider_type ?? '').trim();
  if (!PA_TYPE_LABEL[type]) return { keep: false, reason: 'provider type not in scope' };
  const name = (r.facility_name ?? '').trim();
  if (!name) return { keep: false, reason: 'no facility name' };
  if (!paLicenseId(r)) return { keep: false, reason: 'no provider index' };
  if (CHAIN.test(`${name} ${r.legal_entity_name ?? ''}`)) return { keep: false, reason: 'national chain, franchise, or large multi-site operator' };
  const email = cleanEmail(r.facility_email);
  const phone = formatUsPhone(r.facility_phone);
  if (!email && !phone) return { keep: false, reason: 'no contact detail at all' };
  return { keep: true, ...scoreChildcareRow({ name, legalName: r.legal_entity_name, email, phone, capacity: toCapacity(r.capacity) }) };
}

export function toPaLead(r: PaChildcareRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const raw = (r.facility_name ?? '').trim();
  const name = titleCase(raw);
  const legal = (r.legal_entity_name ?? '').trim();
  const legalName = legal && legal.toUpperCase() !== raw.toUpperCase() ? titleCase(legal) : null;
  const city = (r.facility_city ?? '').trim() || null;
  const location = cityState(city, 'PA');
  const licenseId = paLicenseId(r);
  const phone = formatUsPhone(r.facility_phone);
  const email = cleanEmail(r.facility_email);
  const typeLabel = PA_TYPE_LABEL[(r.provider_type ?? '').trim()];
  const capacity = toCapacity(r.capacity);
  const star = (r.star_level ?? '').trim();
  const licence = (r.license_number ?? '').trim();
  return {
    sourceKey: `childcare:pa:${licenseId}`,
    name,
    legalName,
    city: city ? titleCase(city) : null,
    state: 'PA',
    phone,
    licenseId,
    registryName: PA_REGISTRY,
    typeLabel,
    contactName: null,
    location,
    description: describeRegistryLead({ typeLabel, registryName: PA_REGISTRY, location, legalName, name, listNoun: LIST_NOUN_PA }),
    signalDetail: `PA DHS ${(r.provider_type ?? '').trim()}${licence && licence !== 'N/A' ? ` certificate ${licence}` : ''}, MPI ${licenseId}${r.facility_county ? `, ${titleCase(r.facility_county)} County` : ''}${capacity ? `; capacity ${capacity}` : ''}${star && star !== 'N/A' ? `; ${star}` : ''}${phone ? `; phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email,
    contactSourceUrl: email ? PA_DATASET_URL : null,
  };
}

// ---- network ---------------------------------------------------------------

const TX_SELECT = 'operation_number,operation_name,operation_type,operation_status,temporarily_closed,phone_number,email_address,website_address,administrator_director_name,address_line,city,state,zipcode,county,total_capacity';
const TX_WHERE = `operation_status='Y' AND (${TX_TYPES.map((t) => `operation_type='${t}'`).join(' OR ')})`;

const WA_SELECT = 'sspsprovidernumber,famlinkid,wacompassid,providername,doingbusinessas,facilitytypegeneric,latestoperatingstatus,licensecapacity,primarycontactpersonname,primarycontactphonenumber,primarycontactemail,physicalstreetaddress,physicalcity,physicalstate,physicalcounty';
const WA_WHERE = "latestoperatingstatus='Active'";

const PA_SELECT = 'master_provider_index,mpi_id,mpi_location_id,provider_type,facility_name,facility_phone,facility_email,facility_city,facility_county,facility_zip_code,legal_entity_name,license_number,capacity,star_level';
const PA_WHERE = `(${Object.keys(PA_TYPE_LABEL).map((t) => `provider_type='${t}'`).join(' OR ')})`;

export type ChildcareSource = 'tx' | 'wa' | 'pa';

interface SourceDef {
  host: string;
  dataset: string;
  select: string;
  where: string;
  limit: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluate: (r: any) => Evaluation;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toLead: (r: any, ev: { adjust: number; reasons: string[] }) => RegistryLead;
}

export const CHILDCARE_SOURCES: Record<ChildcareSource, SourceDef> = {
  tx: { host: TX_HOST, dataset: TX_DATASET, select: TX_SELECT, where: TX_WHERE, limit: '12000', evaluate: evaluateTxRow, toLead: toTxLead },
  wa: { host: WA_HOST, dataset: WA_DATASET, select: WA_SELECT, where: WA_WHERE, limit: '5000', evaluate: evaluateWaRow, toLead: toWaLead },
  pa: { host: PA_HOST, dataset: PA_DATASET, select: PA_SELECT, where: PA_WHERE, limit: '9000', evaluate: evaluatePaRow, toLead: toPaLead },
};

// Every candidate the source has, for the bulk import. One request per source:
// each filtered list is a few thousand narrow rows.
export async function allChildcareLeads(
  source: ChildcareSource, opts: { isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const def = CHILDCARE_SOURCES[source];
  const log = opts.log ?? (() => {});
  const result = emptyResult();
  try {
    const rows = await socrataGet<Record<string, string>>(def.host, def.dataset, {
      $select: def.select, $where: def.where, $limit: def.limit, $order: ':id',
    }, log);
    if (!rows.length) throw new Error('no rows returned');
    result.scanned = rows.length;
    for (const r of rows) {
      const ev = def.evaluate(r);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      const lead = def.toLead(r, ev);
      if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); continue; }
      result.candidates.push(lead);
    }
  } catch (e) {
    result.errors.push(`childcare ${source}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

const SLOT_MS = 60 * 60_000;

// Per-run rotation across the three states, weighted by pool size: Texas is the
// largest (7,123) and Pennsylvania next (6,916), so each takes two slots in
// five and Washington (3,151) takes one. Only ONE state is fetched per run,
// exactly like the other verticals' rotations.
export function childcareSourceForSlot(slot: number): ChildcareSource {
  return (['tx', 'pa', 'wa', 'tx', 'pa'] as const)[((slot % 5) + 5) % 5];
}

export async function findChildcareCandidates(
  max: number,
  opts: { now?: Date; source?: ChildcareSource; startOverride?: number; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const slot = Math.floor(now.getTime() / SLOT_MS);
  const source = opts.source ?? childcareSourceForSlot(slot);
  const all = await allChildcareLeads(source, { isKnown: opts.isKnown, log: opts.log });
  const result = emptyResult();
  result.scanned = all.scanned;
  result.rejected = all.rejected;
  result.errors = all.errors;
  if (!all.candidates.length) return result;
  // Slot-rotating window over the full candidate list, so consecutive runs
  // surface different centres instead of retrying the same head of the list.
  const start = opts.startOverride ?? (slot * max) % all.candidates.length;
  for (let i = 0; i < all.candidates.length && result.candidates.length < max; i++) {
    result.candidates.push(all.candidates[(start + i) % all.candidates.length]);
  }
  return result;
}
