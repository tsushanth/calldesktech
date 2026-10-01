import { streamDelimitedRows } from './delimitedStream';
import { callerPhoneExclusion } from './callerPhonePolicy';
import { looksLikeIndividual } from './individualName';
import { cleanEmail, isFreeMail } from './freightFmcsa';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';

// Home-services discovery from the Minnesota Department of Labor and Industry
// (DLI) licence / registration exports, the "Construction Codes and Licensing"
// nightly CSVs linked from https://www.dli.mn.gov/license :
//
//   https://secure.doli.state.mn.us/ccld/data/MNDLILicRegCertExport_<Name>.csv
//
// Public, free, no login, no captcha; secure.doli.state.mn.us/robots.txt returns
// an HTML error page (no rules), and the DLI page itself describes the files as
// "updated nightly and can be sorted and filtered as needed".
//
// Verified live 2026-09-30 (business rows with status Issued only):
//   Electrical                  3,960 business rows (2,630 Class A Electrical Contractor)
//   Plumbing                    2,119 business rows (1,597 Plumbing Contractor)
//   Mechanical_Contractor_Bond  2,557 business rows (HVAC / mechanical bond holders)
//   Residential_Contractors    11,683 business rows, of which 139 Residential Roofer
//   phone populated on 98-99% of those rows; the Email_Address column EXISTS but is
//   empty in every row of every file (0 of ~200k), so this is a phone-first source:
//   registryLeadRow gets a phone and stageEnrich resolves the website/email.
//
// File practicalities: not UTF-8 (read as latin1); header on line 1; dates are
// MM/DD/YYYY; Phone_No is bare digits.
//
// Residential Building / Remodeler contractors are general contractors and are NOT
// kept, for the same reason the WA L&I source drops GENERAL: this vertical targets
// the phone-driven HVAC / plumbing / electrical / roofing service businesses.

export const MN_DLI_BASE = 'https://secure.doli.state.mn.us/ccld/data/MNDLILicRegCertExport_';
export const MN_DLI_SOURCE_URL = 'https://www.dli.mn.gov/license';
export const MN_DLI_REGISTRY = 'Minnesota Department of Labor and Industry';
const LIST_NOUN = 'licence and registration file';

export const MN_FILES = ['Electrical', 'Plumbing', 'Mechanical_Contractor_Bond', 'Residential_Contractors'] as const;
export type MnFile = (typeof MN_FILES)[number];

export const MN_COL = {
  busPers: 'Bus_Pers',
  type: 'License_Type',
  subtype: 'License_Subtype',
  name: 'Name',
  dba: 'DBA_Name',
  city: 'City',
  state: 'St',
  phone: 'Phone_No',
  email: 'Email_Address',
  lic: 'Lic_Number',
  status: 'Status',
  exp: 'Exp_Date',
} as const;

export interface MnDliRow {
  busPers: string;
  type: string;
  subtype: string;
  name: string;
  dba: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  lic: string;
  status: string;
  exp: string | null;
}

export function toMnDliRow(o: Record<string, string>): MnDliRow {
  const v = (k: string) => (o[k] ?? '').trim() || null;
  return {
    busPers: (o[MN_COL.busPers] ?? '').trim(),
    type: (o[MN_COL.type] ?? '').trim(),
    subtype: (o[MN_COL.subtype] ?? '').trim(),
    name: (o[MN_COL.name] ?? '').replace(/\s+/g, ' ').trim(),
    dba: v(MN_COL.dba),
    city: v(MN_COL.city),
    state: v(MN_COL.state),
    phone: v(MN_COL.phone),
    email: v(MN_COL.email),
    lic: (o[MN_COL.lic] ?? '').trim(),
    status: (o[MN_COL.status] ?? '').trim(),
    exp: v(MN_COL.exp),
  };
}

// MM/DD/YYYY
export function parseMnDate(raw: string | null | undefined): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((raw ?? '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
  return Number.isNaN(d.getTime()) ? null : d;
}

// Subtypes kept, keyed on the exact DLI wording. Anything else (journeyworkers,
// employer registrations, bonds, technology-systems / low-voltage firms, general
// building contractors) is rejected by evaluateMnDliRow.
const KEPT_SUBTYPES: Record<string, string> = {
  'Class A Electrical Contractor': 'licensed electrical contractor',
  'Class B Electrical Contractor': 'licensed electrical contractor',
  'Plumbing Contractor': 'licensed plumbing contractor',
  'Restricted Plumbing Contractor': 'licensed plumbing contractor',
  'Mechanical Contractor Bond': 'bonded mechanical (HVAC) contractor',
  'Residential Roofer Contractor': 'licensed residential roofing contractor',
};

const BIG_HOMESERVICES = /\b(roto[- ]?rooter|mr\.? rooter|mr\.? electric|one hour heating|benjamin franklin plumbing|aire serv|ars\/?rescue rooter|service experts|home depot|lowe'?s|sears|comfort systems|emcor|limbach|\bapi group\b|\bmmr\b|kiewit|quanta services|\bmyr group\b|xcel energy|johnson controls|siemens|honeywell|trane|carrier|lennox|\bmortenson\b|\bmccarthy\b|\bmcgough\b|\bgraybar\b|\bwinco\b|\bapi\b mechanical)\b/i;
const STAFFING = /\b(staffing|manpower|man ?power|labor ?(ready|solutions|services)|staff ?leasing|employee leasing|\bpeo\b|personnel|temporaries|payroll)\b/i;

export type Evaluation = { keep: true; adjust: number; reasons: string[]; typeLabel: string } | { keep: false; reason: string };

export function evaluateMnDliRow(r: MnDliRow, now = new Date()): Evaluation {
  if (!r.lic) return { keep: false, reason: 'no licence id' };
  if (r.busPers.toLowerCase() !== 'business') return { keep: false, reason: 'individual licence, not a business' };
  if (r.status.toLowerCase() !== 'issued') return { keep: false, reason: 'licence not in issued status' };
  const exp = parseMnDate(r.exp);
  if (!exp || exp.getTime() < now.getTime()) return { keep: false, reason: 'licence expired' };
  const typeLabel = KEPT_SUBTYPES[r.subtype];
  if (!typeLabel) return { keep: false, reason: 'licence subtype is not an HVAC/plumbing/electrical/roofing contractor' };
  const name = r.dba || r.name;
  if (!name) return { keep: false, reason: 'no business name' };
  if (BIG_HOMESERVICES.test(name)) return { keep: false, reason: 'national brand, franchise or large industrial contractor name' };
  if (STAFFING.test(name)) return { keep: false, reason: 'staffing, manpower or payroll company' };
  const phone = formatUsPhone(r.phone);
  const email = cleanEmail(r.email);
  if (!phone && !email) return { keep: false, reason: 'no contact detail at all' };

  const reasons: string[] = [];
  let adjust = 3;
  reasons.push('+3: DLI licence is an HVAC/plumbing/electrical/roofing contractor class');
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };
  if (!phone) add(-5, 'no usable phone in the DLI record');
  if (!email) add(-10, 'no published email in the DLI file (the column is empty in every row)');
  else if (isFreeMail(email)) add(-5, 'contact is a free-mail address (no business domain to verify)');
  else add(5, 'business-domain email published in the DLI file');
  // A licence held in a person's own name is a sole proprietor: still callable,
  // but website discovery rarely finds anything for them (see individualName.ts).
  if (!r.dba && looksLikeIndividual(r.name)) add(-3, 'licensed in a personal name (sole proprietor); website discovery rarely resolves one');
  if (r.state && r.state.toUpperCase() !== 'MN') add(-3, 'licensed in Minnesota but based out of state');
  return { keep: true, adjust, reasons, typeLabel };
}

export function toMnDliLead(r: MnDliRow, ev: { adjust: number; reasons: string[]; typeLabel: string }): RegistryLead {
  const name = titleCase(r.dba || r.name);
  const legalName = r.dba && r.name && r.dba !== r.name ? titleCase(r.name) : null;
  const state = (r.state ?? 'MN').toUpperCase();
  const location = cityState(r.city, state);
  const email = cleanEmail(r.email);
  const usable = email && !isFreeMail(email) ? email : null;
  const phone = formatUsPhone(r.phone);
  const id = r.lic.toUpperCase();
  // A DBA over a legal name that is just a person ("Udovich Electric" / "Udovich Anthony F") is a sole proprietor;
  // so is a trade-named business whose displayed name is a person. The DLI file has no entity-type column.
  // (typeLabel is deliberately NOT passed: the shared home-based wording matches 'residential' roofer.)
  const soleProprietor = !!(r.dba && r.name && looksLikeIndividual(r.name));
  return {
    sourceKey: `homeservices:mn:${id}`,
    name,
    legalName,
    city: r.city ? titleCase(r.city) : null,
    state,
    phone,
    callerPhoneExcluded: phone ? callerPhoneExclusion({ name, soleProprietor }) : null,
    licenseId: id,
    registryName: MN_DLI_REGISTRY,
    typeLabel: ev.typeLabel,
    contactName: null,
    location,
    description: describeRegistryLead({ typeLabel: ev.typeLabel, registryName: MN_DLI_REGISTRY, location, legalName, name, listNoun: LIST_NOUN }),
    signalDetail: `Minnesota DLI ${r.subtype} ${id}${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: usable,
    contactSourceUrl: usable ? MN_DLI_SOURCE_URL : null,
  };
}

// ---- network ---------------------------------------------------------------

const REQUIRED = [MN_COL.busPers, MN_COL.subtype, MN_COL.name, MN_COL.phone, MN_COL.lic, MN_COL.status, MN_COL.exp];

const normBiz = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

export async function streamMnDliLeads(
  opts: { now?: Date; files?: readonly MnFile[]; isKnown?: (sourceKey: string) => boolean; baseUrl?: string; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();
  const seen = new Set<string>();
  // One business routinely holds an electrical AND a plumbing AND a mechanical licence (different Lic_Number,
  // same name and phone): keep one lead per name+phone, the lowest licence id, so the choice does not depend on
  // file order and the sourceKey stays stable across runs.
  const byBiz = new Map<string, RegistryLead>();
  for (const file of opts.files ?? MN_FILES) {
    try {
      await streamDelimitedRows({
        url: `${opts.baseUrl ?? MN_DLI_BASE}${file}.csv`,
        delimiter: 'comma',
        encoding: 'latin1',
        requiredColumns: REQUIRED,
        minRows: 500,
        log: opts.log,
        onRow: (o) => {
          result.scanned++;
          const r = toMnDliRow(o);
          const ev = evaluateMnDliRow(r, now);
          if (!ev.keep) { reject(result, ev.reason); return; }
          const lead = toMnDliLead(r, ev);
          if (seen.has(lead.sourceKey)) { reject(result, 'duplicate licence id'); return; }
          seen.add(lead.sourceKey);
          const bk = `${normBiz(lead.name)}|${(lead.phone ?? '').replace(/\D/g, '')}|${lead.email ?? ''}`;
          const prev = byBiz.get(bk);
          if (prev) {
            reject(result, 'same business already listed under another licence');
            if (lead.licenseId < prev.licenseId) byBiz.set(bk, lead);
            return;
          }
          byBiz.set(bk, lead);
        },
      });
    } catch (e) {
      result.errors.push(`homeservices mn ${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const lead of byBiz.values()) {
    if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); continue; }
    result.candidates.push(lead);
  }
  // Stable order regardless of file order (the day-rotation window below indexes into it).
  result.candidates.sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0));
  return result;
}

const DAY_MS = 86_400_000;

// One pass over the four files per run, then a day-rotating window of `max` leads
// (same shape as the Arkansas source).
export async function findMnDliCandidates(
  max: number,
  opts: { now?: Date; startOverride?: number; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();
  const all = await streamMnDliLeads({ now, isKnown: opts.isKnown, log: opts.log });
  result.scanned = all.scanned;
  result.rejected = all.rejected;
  result.errors = all.errors;
  if (!all.candidates.length) return result;
  const day = Math.floor(now.getTime() / DAY_MS);
  const start = opts.startOverride ?? (day * max) % all.candidates.length;
  for (let i = 0; i < all.candidates.length && result.candidates.length < max; i++) {
    result.candidates.push(all.candidates[(start + i) % all.candidates.length]);
  }
  return result;
}
