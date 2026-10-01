import { fetchTylerRoster } from './tylerRoster';
import { cleanEmail, isFreeMail } from './freightFmcsa';
import { looksLikeIndividual } from './individualName';
import { callerPhoneExclusion } from './callerPhonePolicy';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, splitDba, type RegistryLead, type RegistryResult } from './registryCommon';

// Two Ohio licensee rosters from the state's own eLicense Online "Generate
// Roster(s)" downloads (see tylerRoster.ts: free, "No Fee Required", no login):
//
//  1. OCILB  elicense4.com.ohio.gov  Ohio Construction Industry Licensing Board
//     - the HVAC / electrical / plumbing / hydronics / refrigeration CONTRACTOR
//     licences (homeservices). Verified live 2026-09-30: 12,587 rows, all ACTIVE
//     or ACTIVE IN RENEWAL, 8,555 distinct companies (one company often holds
//     several trade licences), Company Phone on 7,833 of the 11,956 ACTIVE rows
//     (66%), Company Email on 440 (3.7%). Phone-first.
//     One row per licence = the QUALIFYING INDIVIDUAL plus the COMPANY they
//     qualify; the lead is the company. "TA" (training agency) rows are skipped.
//
//  2. Real Estate  elicense3.com.ohio.gov  Ohio Division of Real Estate and
//     Professional Licensing - brokerage "Real Estate Company" and "Sole
//     Proprietor" licences (realestate). Verified live 2026-09-30: 2,865 ACTIVE
//     Real Estate Company rows (2,231 = 77.9% with an email) and 602 ACTIVE Sole
//     Proprietor rows (564 = 93.7% with an email). There is NO phone column.
//     Branch offices (1,609 active, 0.4% email) duplicate a company and are not
//     kept. 57% of the company emails are free-mail (gmail 545 of ~2,230): these
//     are small owner-run brokerages, so the address is KEPT as the contact and
//     scored down, exactly as the childcare source treats free-mail.
//
// Licence data is public record published for verification; the sources carry no
// use restriction on the pages, but the rosters contain personal emails of sole
// proprietors, which is why individuals are scored down (see below) and why no
// email is ever stated in the lead description.

export const OH_OCILB_HOST = 'elicense4.com.ohio.gov';
export const OH_RE_HOST = 'elicense3.com.ohio.gov';
export const OH_OCILB_REGISTRY = 'Ohio Construction Industry Licensing Board';
export const OH_RE_REGISTRY = 'Ohio Division of Real Estate and Professional Licensing';
export const OH_OCILB_SOURCE_URL = 'https://elicense4.com.ohio.gov/Lookup/LicenseLookup.aspx';
export const OH_RE_SOURCE_URL = 'https://elicense3.com.ohio.gov/Lookup/LicenseLookup.aspx';
const LIST_NOUN = 'licensee roster';
// <option value> ids of "Real Estate Company (REC)" and "Sole Proprietor (SOLE)" on elicense3.
export const OH_RE_TYPE_IDS = ['44', '61'];

const BIG_HOMESERVICES = /\b(roto[- ]?rooter|mr\.? rooter|mr\.? electric|one hour heating|benjamin franklin plumbing|aire serv|ars\/?rescue rooter|service experts|home depot|lowe'?s|sears|comfort systems|emcor|limbach|\bapi group\b|\bmmr\b|kiewit|quanta services|\bmyr group\b|american electric power|\baep\b|firstenergy|johnson controls|siemens|honeywell|trane|carrier|lennox|ohio edison|duke energy)\b/i;
const STAFFING = /\b(staffing|manpower|man ?power|labor ?(ready|solutions|services)|staff ?leasing|employee leasing|\bpeo\b|personnel|temporaries|payroll)\b/i;
const BIG_REALESTATE = /\b(keller williams|re\/?max|coldwell banker|century 21|\bcompass\b|sotheby|berkshire hathaway|exp realty|douglas elliman|\bredfin\b|\bzillow\b|opendoor|howard hanna|\bhomeservices of america\b|weichert|better homes and gardens|realty one group|\bhomesmart\b|\bepique\b|\bfathom\b)\b/i;

export type Evaluation = { keep: true; adjust: number; reasons: string[]; typeLabel: string } | { keep: false; reason: string };

// ---- OCILB (homeservices) ---------------------------------------------------

export interface OhOcilbRow {
  credential: string; // FormattedCredential, e.g. "EL.10597"
  person: string; // qualifying individual
  lastName: string; // qualifying individual's surname
  expires: string | null; // MM/DD/YYYY
  type: string; // EL | HV | HY | PL | RE | TA
  status: string;
  company: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
}

export const OH_OCILB_TYPES: Record<string, string> = {
  EL: 'licensed electrical contractor',
  HV: 'licensed HVAC contractor',
  HY: 'licensed hydronics contractor',
  PL: 'licensed plumbing contractor',
  RE: 'licensed refrigeration contractor',
};

export function toOhOcilbRow(o: Record<string, string>): OhOcilbRow {
  const v = (k: string) => (o[k] ?? '').trim() || null;
  return {
    credential: (o['FormattedCredential'] ?? '').trim(),
    person: (o['Name'] ?? '').trim(),
    lastName: (o['LastName'] ?? '').trim(),
    expires: v('Expiration Date'),
    type: (o['Type'] ?? '').trim().toUpperCase(),
    status: (o['Status'] ?? '').trim().toUpperCase(),
    company: (o['Company'] ?? '').replace(/\s+/g, ' ').trim(),
    city: v('Company City'),
    state: v('Company State'),
    zip: v('Company Zip'),
    phone: v('Company Phone'),
    email: v('Company Email'),
  };
}

const ENTITY_SUFFIX = /\b(inc|incorporated|llc|l\.?l\.?c|llp|lllp|lp|ltd|limited|corp|corporation|co|company|pllc|pc|p\.c|association|assoc|partnership|cooperative|trust)\b\.?/i;

function mdy(raw: string | null | undefined): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((raw ?? '').trim());
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]))) : null;
}

// The OCILB roster has no entity-type column. A company with no corporate suffix that carries the qualifying
// individual's own surname ("Thomas Cornwell Electric" qualified by Thomas J Cornwell) is a sole proprietorship
// run in that person's name; so is a company whose name is just a person.
export function ocilbSoleProprietor(r: OhOcilbRow): boolean {
  if (ENTITY_SUFFIX.test(r.company)) return false;
  if (looksLikeIndividual(r.company)) return true;
  const last = (r.lastName || r.person.split(/\s+/).filter((t) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(t)).pop() || '').toLowerCase();
  if (last.length < 3) return false;
  return r.company.toLowerCase().split(/[^a-z']+/).includes(last);
}

// A row still marked ACTIVE whose expiry is more than 60 days past is a stale record, not a live licence
// ('ACTIVE IN RENEWAL' rows are expected to be past expiry and are kept).
export function evaluateOhOcilbRow(r: OhOcilbRow, now = new Date()): Evaluation {
  if (!r.credential) return { keep: false, reason: 'no licence id' };
  if (!r.status.startsWith('ACTIVE')) return { keep: false, reason: 'licence not active' };
  const exp = mdy(r.expires);
  if (r.status === 'ACTIVE' && exp && now.getTime() - exp.getTime() > 60 * 86_400_000) return { keep: false, reason: 'licence marked active but expired more than 60 days ago' };
  const typeLabel = OH_OCILB_TYPES[r.type];
  if (!typeLabel) return { keep: false, reason: 'licence type is not an HVAC/plumbing/electrical/refrigeration contractor' };
  if (!r.company) return { keep: false, reason: 'no business name' };
  if (BIG_HOMESERVICES.test(r.company)) return { keep: false, reason: 'national brand, franchise or large industrial contractor name' };
  if (STAFFING.test(r.company)) return { keep: false, reason: 'staffing, manpower or payroll company' };
  const phone = formatUsPhone(r.phone);
  const email = cleanEmail(r.email);
  if (!phone && !email) return { keep: false, reason: 'no contact detail at all' };

  const reasons: string[] = ['+3: OCILB licence is an HVAC/plumbing/electrical/refrigeration contractor class'];
  let adjust = 3;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };
  if (!phone) add(-5, 'no usable phone in the roster record');
  if (!email) add(-10, 'no published email in the roster record');
  else if (isFreeMail(email)) add(-5, 'contact is a free-mail address (no business domain to verify)');
  else add(5, 'business-domain email published in the roster');
  if (looksLikeIndividual(r.company)) add(-3, 'company is a personal name (sole proprietor); website discovery rarely resolves one');
  if (r.state && r.state.toUpperCase() !== 'OH') add(-3, 'licensed in Ohio but based out of state');
  return { keep: true, adjust, reasons, typeLabel };
}

export function toOhOcilbLead(r: OhOcilbRow, ev: { adjust: number; reasons: string[]; typeLabel: string }): RegistryLead {
  const { legal, dba } = splitDba(r.company);
  const name = titleCase(dba ?? legal);
  const legalName = dba ? titleCase(legal) : null;
  const state = (r.state ?? 'OH').toUpperCase();
  const location = cityState(r.city, state);
  const email = cleanEmail(r.email);
  const usable = email && !isFreeMail(email) ? email : null;
  const phone = formatUsPhone(r.phone);
  const id = r.credential.toUpperCase();
  return {
    sourceKey: `homeservices:oh:${id}`,
    name, legalName, city: r.city ? titleCase(r.city) : null, state, phone, licenseId: id,
    callerPhoneExcluded: phone ? callerPhoneExclusion({ name, soleProprietor: ocilbSoleProprietor(r) }) : null,
    registryName: OH_OCILB_REGISTRY,
    typeLabel: ev.typeLabel,
    // The qualifying individual is a named person in a public record: kept for a
    // human follow-up call only, never used in a draft.
    contactName: r.person ? titleCase(r.person) : null,
    location,
    description: describeRegistryLead({ typeLabel: ev.typeLabel, registryName: OH_OCILB_REGISTRY, location, legalName, name, listNoun: LIST_NOUN }),
    signalDetail: `Ohio OCILB licence ${id}${phone ? `; roster phone ${phone}` : ''}`,
    adjust: ev.adjust, reasons: ev.reasons,
    email: usable,
    contactSourceUrl: usable ? OH_OCILB_SOURCE_URL : null,
  };
}

// ---- Real estate ------------------------------------------------------------

export interface OhRealEstateRow {
  credential: string; // e.g. "BRK.2008000123" / "REC.xxx"
  type: string; // "Real Estate Company" | "Sole Proprietor"
  status: string;
  company: string;
  first: string | null;
  last: string | null;
  city: string | null;
  state: string | null;
  email: string | null;
}

export function toOhRealEstateRow(o: Record<string, string>): OhRealEstateRow {
  const v = (k: string) => (o[k] ?? '').trim() || null;
  return {
    credential: (o['Credential'] ?? '').trim(),
    type: (o['Credential Type'] ?? '').trim(),
    status: (o['Status'] ?? '').trim().toUpperCase(),
    company: (o['Company Name'] ?? '').replace(/\s+/g, ' ').trim(),
    first: v('First Name'),
    last: v('Last Name'),
    city: v('City'),
    state: v('State'),
    email: v('Email Address'),
  };
}

// The company name can be wrapped in "$...$" sort markers ("$2100$ Realty ...").
export function cleanRealEstateName(raw: string): string {
  return raw.replace(/^[$!#*\s]+/, '').replace(/\$(?=\s)/, '').replace(/\s+/g, ' ').trim();
}

const RE_TYPES: Record<string, string> = {
  'Real Estate Company': 'licensed real estate brokerage',
  'Sole Proprietor': 'licensed real estate broker',
};

// A sole-proprietor licence has no company name: the broker's own name is the business.
function reDisplayName(r: OhRealEstateRow): string {
  const name = cleanRealEstateName(r.company);
  if (name || r.type !== 'Sole Proprietor') return name;
  return [r.first, r.last].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function evaluateOhRealEstateRow(r: OhRealEstateRow): Evaluation {
  if (!r.credential) return { keep: false, reason: 'no licence id' };
  if (r.status !== 'ACTIVE') return { keep: false, reason: 'licence not active' };
  const typeLabel = RE_TYPES[r.type];
  if (!typeLabel) return { keep: false, reason: 'credential type is not a brokerage company or sole-proprietor broker' };
  const name = reDisplayName(r);
  if (!name) return { keep: false, reason: 'no business name' };
  if (BIG_REALESTATE.test(name)) return { keep: false, reason: 'national real estate brand or franchise name' };
  const email = cleanEmail(r.email);
  // No phone column exists in this roster: without an email there is nothing to contact.
  if (!email) return { keep: false, reason: 'no contact detail at all (roster has no phone column)' };

  const reasons: string[] = ['+3: licensed real estate brokerage'];
  let adjust = 3;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };
  if (isFreeMail(email)) add(-5, 'contact is a free-mail address (typical of a small owner-run brokerage; no business domain to verify)');
  else add(5, 'business-domain email published in the roster');
  if (r.type === 'Sole Proprietor') add(-6, 'sole-proprietor broker (personal licence, name is the person)');
  else if (looksLikeIndividual(name)) add(-3, 'company is a personal name (sole proprietor)');
  if (r.state && r.state.toUpperCase() !== 'OH') add(-3, 'licensed in Ohio but based out of state');
  return { keep: true, adjust, reasons, typeLabel };
}

export function toOhRealEstateLead(r: OhRealEstateRow, ev: { adjust: number; reasons: string[]; typeLabel: string }): RegistryLead {
  const { legal, dba } = splitDba(reDisplayName(r));
  const name = titleCase(dba ?? legal);
  const legalName = dba ? titleCase(legal) : null;
  const state = (r.state ?? 'OH').toUpperCase();
  const location = cityState(r.city, state);
  const email = cleanEmail(r.email);
  const id = r.credential.toUpperCase();
  const person = [r.first, r.last].filter(Boolean).join(' ');
  return {
    sourceKey: `realestate:oh:${id}`,
    name, legalName, city: r.city ? titleCase(r.city) : null, state,
    phone: null,
    // The roster has no phone, so nothing callable is exposed either way; the reason is recorded so a phone
    // added later by website discovery of a sole proprietor is not treated as a business line.
    callerPhoneExcluded: callerPhoneExclusion({ name: r.type === 'Sole Proprietor' ? name : '', soleProprietor: r.type === 'Sole Proprietor' }),
    licenseId: id,
    registryName: OH_RE_REGISTRY,
    typeLabel: ev.typeLabel,
    contactName: person ? titleCase(person) : null,
    location,
    description: describeRegistryLead({ typeLabel: ev.typeLabel, registryName: OH_RE_REGISTRY, location, legalName, name, listNoun: LIST_NOUN }),
    signalDetail: `Ohio Division of Real Estate ${r.type} ${id}`,
    adjust: ev.adjust, reasons: ev.reasons,
    // Free-mail is KEPT as the contact (pipeline.registryLeadRow derives a null
    // domain for it); see the header comment.
    email,
    contactSourceUrl: OH_RE_SOURCE_URL,
  };
}

// ---- network ----------------------------------------------------------------

const normCompany = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

export async function streamOhOcilbLeads(
  opts: { isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void; rows?: Record<string, string>[]; now?: Date } = {},
): Promise<RegistryResult> {
  const result = emptyResult();
  try {
    const rows = opts.rows ?? (await fetchTylerRoster({ host: OH_OCILB_HOST, log: opts.log }));
    // One company can hold EL + PL + HV licences (and several qualifiers): keep ONE row per company+zip, the
    // lowest licence id among the rows that passed, so the lead's sourceKey does not depend on roster row order.
    const best = new Map<string, { lead: RegistryLead; row: OhOcilbRow }>();
    for (const o of rows) {
      result.scanned++;
      const r = toOhOcilbRow(o);
      const ev = evaluateOhOcilbRow(r, opts.now);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      const ck = `${normCompany(r.company)}|${(r.zip ?? '').slice(0, 5)}`;
      const lead = toOhOcilbLead(r, ev);
      const prev = best.get(ck);
      if (prev) {
        reject(result, 'same company already listed under another licence');
        if (lead.licenseId < prev.lead.licenseId) best.set(ck, { lead, row: r });
        continue;
      }
      best.set(ck, { lead, row: r });
    }
    const keys = new Set<string>();
    for (const { lead } of best.values()) {
      if (keys.has(lead.sourceKey)) { reject(result, 'duplicate licence id'); continue; }
      keys.add(lead.sourceKey);
      if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); continue; }
      result.candidates.push(lead);
    }
    result.candidates.sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : 1));
  } catch (e) {
    result.errors.push(`homeservices oh: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

export async function streamOhRealEstateLeads(
  opts: { isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void; rows?: Record<string, string>[] } = {},
): Promise<RegistryResult> {
  const result = emptyResult();
  try {
    const rows = opts.rows ?? (await fetchTylerRoster({ host: OH_RE_HOST, credentialTypeIds: OH_RE_TYPE_IDS, log: opts.log }));
    const seen = new Set<string>();
    for (const o of rows) {
      result.scanned++;
      const r = toOhRealEstateRow(o);
      const ev = evaluateOhRealEstateRow(r);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      const lead = toOhRealEstateLead(r, ev);
      if (seen.has(lead.sourceKey)) { reject(result, 'duplicate licence id'); continue; }
      seen.add(lead.sourceKey);
      if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); continue; }
      result.candidates.push(lead);
    }
  } catch (e) {
    result.errors.push(`realestate oh: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
