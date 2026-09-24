import { socrataGet } from './socrata';
import { cleanEmail, isFreeMail } from './freightFmcsa';
import { titleCase, cityState, describeRegistryLead, formatUsPhone, type RegistryLead } from './registryCommon';

// Two further septic registries beyond FL DOH and Austin:
//
//  (a) Delaware on-site wastewater licensees (data.delaware.gov 56uc-mvju, 611
//      rows, ~500 with an email). Rows are per INDIVIDUAL licensee, so several
//      rows share one company; we collapse to one lead per company. This is the
//      only septic source with an email, and the emails are a mix of business
//      addresses and personal ones (aol/msn/yahoo). A free-mail address tells us
//      nothing about the business's own domain, so only a business-domain email
//      is used as the lead contact; free-mail rows fall through to the normal
//      website/email discovery instead.
//  (b) Missouri on-site wastewater system installers (data.mo.gov nfxa-cq5r,
//      ~1,560 rows, phone only, some registered from out of state).

export const DE_HOST = 'data.delaware.gov';
export const DE_DATASET = '56uc-mvju';
export const DE_REGISTRY = 'Delaware Department of Natural Resources and Environmental Control';
export const DE_SOURCE_URL = 'https://data.delaware.gov/Energy-and-Environment/Licensed-On-Site-Wastewater-Professionals/56uc-mvju';
export const MO_HOST = 'data.mo.gov';
export const MO_DATASET = 'nfxa-cq5r';
export const MO_REGISTRY = 'Missouri Department of Health and Senior Services';

export interface DeRow {
  displayname?: string;
  licensenumber?: string;
  licensesubtype?: string;
  licstatus?: string;
  companyname?: string;
  companyaddress?: string;
  companyphone?: string;
  companyemailaddress?: string;
}

export interface MoRow {
  business?: string;
  city?: string;
  state?: string;
  business_phone?: string;
  installer_id?: string;
  installer_level?: string;
  date_of_expiration?: string;
}

export type Evaluation = { keep: true; adjust: number; reasons: string[] } | { keep: false; reason: string };

const BIG_SEPTIC = /\b(roto[- ]?rooter|mr\.? rooter|waste management|republic services|waste connections|terminix|orkin)\b/i;

// "344 Skeeter Neck Road, Frederica, DE 19946 US" -> { city: 'Frederica', state: 'DE' }
export function parseDeAddress(raw: string | undefined | null): { city: string | null; state: string | null } {
  const m = /,\s*([^,]+?),\s*([A-Z]{2})\s+\d{5}/.exec((raw ?? '').trim());
  if (m) return { city: m[1].trim(), state: m[2] };
  const m2 = /\b([A-Z]{2})\s+\d{5}/.exec((raw ?? '').trim());
  return { city: null, state: m2 ? m2[1] : null };
}

// Licence subtypes that are actual septic SERVICE businesses we can offer a
// phone agent to: system contractors (installers) and liquid-waste haulers
// (pumpers). Inspectors, evaluators, designers and soil scientists are
// individual professionals, not call-driven service companies.
const DE_SUBTYPES: { re: RegExp; label: string }[] = [
  { re: /class\s*f\b|liquid waste/i, label: 'licensed liquid waste hauler' },
  { re: /class\s*e\b|system contractor/i, label: 'licensed on-site wastewater system contractor' },
];

export function evaluateDeRow(r: DeRow): Evaluation {
  if (!r.companyname?.trim()) return { keep: false, reason: 'no company name (individual only)' };
  if (!r.licensenumber?.trim()) return { keep: false, reason: 'no licence number' };
  if ((r.licstatus ?? '').toLowerCase() !== 'approved') return { keep: false, reason: 'licence not approved' };
  if (!DE_SUBTYPES.some((s) => s.re.test(r.licensesubtype ?? ''))) return { keep: false, reason: 'licence subtype is not a contractor or hauler' };
  if (BIG_SEPTIC.test(r.companyname)) return { keep: false, reason: 'national/franchise name' };
  const reasons: string[] = [];
  let adjust = 0;
  const email = cleanEmail(r.companyemailaddress);
  if (email && !isFreeMail(email)) { adjust += 5; reasons.push('+5: business-domain email published in the licensee list'); }
  if (!formatUsPhone(r.companyphone)) { adjust -= 5; reasons.push('-5: no usable phone in the registry record'); }
  return { keep: true, adjust, reasons };
}

export function deTypeLabel(subtype: string | undefined): string {
  return DE_SUBTYPES.find((s) => s.re.test(subtype ?? ''))?.label ?? 'licensed on-site wastewater professional';
}

// Company-level dedupe key: the registry has one row per licensed person.
export function deCompanyKey(r: DeRow): string {
  return (r.companyname ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 48);
}

export function collapseDeByCompany(rows: DeRow[]): DeRow[] {
  const by = new Map<string, DeRow>();
  for (const r of rows) {
    const key = deCompanyKey(r);
    if (!key) continue;
    const prev = by.get(key);
    // Prefer the row that carries a business-domain email, then any email.
    const rank = (x: DeRow) => {
      const e = cleanEmail(x.companyemailaddress);
      return e ? (isFreeMail(e) ? 1 : 2) : 0;
    };
    if (!prev || rank(r) > rank(prev)) by.set(key, r);
  }
  return [...by.values()];
}

export function toDeLead(r: DeRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const name = titleCase((r.companyname as string).trim());
  const { city, state } = parseDeAddress(r.companyaddress);
  const location = cityState(city, state ?? 'DE');
  const typeLabel = deTypeLabel(r.licensesubtype);
  const phone = formatUsPhone(r.companyphone);
  const email = cleanEmail(r.companyemailaddress);
  // Only a business-domain address is treated as the company's contact; a
  // personal free-mail address goes no further than signals/scoring.
  const usable = email && !isFreeMail(email) ? email : null;
  return {
    sourceKey: `septic:de:${deCompanyKey(r)}`,
    name, legalName: null, city: city ? titleCase(city) : null, state: state ?? 'DE', phone,
    licenseId: (r.licensenumber as string).trim(),
    registryName: DE_REGISTRY, typeLabel, contactName: null, location,
    description: describeRegistryLead({ typeLabel, registryName: DE_REGISTRY, location, legalName: null, name, listNoun: 'licensed on-site wastewater professionals list' }),
    signalDetail: `DE DNREC on-site wastewater licence ${(r.licensenumber as string).trim()} (${(r.licensesubtype ?? '').trim()})${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust, reasons: ev.reasons,
    email: usable,
    contactSourceUrl: usable ? DE_SOURCE_URL : null,
  };
}

export function evaluateMoRow(r: MoRow, now = new Date()): Evaluation {
  if (!r.business?.trim()) return { keep: false, reason: 'no business name' };
  if (!r.installer_id?.trim()) return { keep: false, reason: 'no installer id' };
  const exp = r.date_of_expiration ? new Date(r.date_of_expiration.endsWith('Z') ? r.date_of_expiration : `${r.date_of_expiration}Z`) : null;
  if (!exp || Number.isNaN(exp.getTime()) || exp.getTime() < now.getTime()) return { keep: false, reason: 'registration expired' };
  if (BIG_SEPTIC.test(r.business)) return { keep: false, reason: 'national/franchise name' };
  const reasons: string[] = [];
  let adjust = 0;
  if (!formatUsPhone(r.business_phone)) { adjust -= 5; reasons.push('-5: no usable phone in the registry record'); }
  if (/advanced|master/i.test(r.installer_level ?? '')) { adjust += 3; reasons.push('+3: advanced installer registration (established operator)'); }
  return { keep: true, adjust, reasons };
}

export function toMoLead(r: MoRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const name = titleCase((r.business as string).trim());
  const city = r.city?.trim() || null;
  const state = (r.state?.trim() || 'MO').toUpperCase();
  const location = cityState(city, state);
  const typeLabel = 'registered on-site wastewater system installer';
  const phone = formatUsPhone(r.business_phone);
  const id = (r.installer_id as string).trim();
  return {
    sourceKey: `septic:mo:${id}`,
    name, legalName: null, city: city ? titleCase(city) : null, state, phone, licenseId: id,
    registryName: MO_REGISTRY, typeLabel, contactName: null, location,
    description: describeRegistryLead({ typeLabel, registryName: MO_REGISTRY, location, legalName: null, name }),
    signalDetail: `MO DHSS on-site wastewater installer ${id}${r.installer_level ? ` (${r.installer_level})` : ''}${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust, reasons: ev.reasons,
  };
}

export async function fetchDeRows(log: (m: string) => void = () => {}): Promise<DeRow[]> {
  return socrataGet<DeRow>(DE_HOST, DE_DATASET, {
    $order: 'licensenumber', $limit: '1000',
    $select: 'displayname,licensenumber,licensesubtype,licstatus,companyname,companyaddress,companyphone,companyemailaddress',
  }, log);
}

export async function fetchMoSepticRows(log: (m: string) => void = () => {}): Promise<MoRow[]> {
  return socrataGet<MoRow>(MO_HOST, MO_DATASET, {
    $order: 'installer_id', $limit: '2000',
    $select: 'business,city,state,business_phone,installer_id,installer_level,date_of_expiration',
  }, log);
}
