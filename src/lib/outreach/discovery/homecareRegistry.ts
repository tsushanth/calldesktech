import { socrataGet } from './socrata';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, splitDba, type RegistryLead, type RegistryResult } from './registryCommon';

// Home-care discovery from two state health-department open datasets (no email):
//  * Illinois IDPH "Home Health Agency Directory" (illinois-edp.data.socrata.com
//    p7mg-cnpx, ~590 rows; name, address, phone, contact_name, licence, expiry).
//    Most are MEDICAL home health agencies; the dataset has no licence-type or
//    category column, so non-medical vs medical can only be inferred from the
//    NAME. Ambiguous ones are kept but scored down.
//  * New York "Licensed Home Care Services Agency" list (health.data.ny.gov
//    6nen-x7rm, ~1,260 with registration_status 'Yes'; name/dba/address/licence,
//    no phone). LHCSAs provide aide/personal-care services, closer to non-medical.
//    (registration_status 'Yes' is the only reliable inclusion signal in the dataset; the
//    dataset title is a 2024 registration-status list, so 'No' rows are skipped.)

export const IL_HOST = 'illinois-edp.data.socrata.com';
export const IL_DATASET = 'p7mg-cnpx';
export const NY_HOST = 'health.data.ny.gov';
export const NY_DATASET = '6nen-x7rm';
const IL_REGISTRY = 'Illinois Department of Public Health';
const NY_REGISTRY = 'New York State Department of Health';

export interface IlRow { facility_name?: string; address?: string; city?: string; county?: string; zip?: string; contact_name?: string; phone?: string; license_number?: string; exp_date?: string }
export interface NyRow { license_number?: string; agency?: string; dba?: string; address?: string; city?: string; state?: string; zip_code?: string; registration_status?: string }

// Institutions: hospitals, health systems, universities, governments. Not small operators; hard skip.
const INSTITUTION = /\b(hospital|health systems?|medical center|university|college|county|city of|village of|department of|health department|clinic|foundation|memorial|regional health|healthcare systems?)\b/i;
// Well-known national home-care chains/franchisors. Scored down, not skipped
// (a franchisee can be a small owner-run business, but is less likely to own its phone process).
const CHAIN = /\b(home instead|comfort keepers|visiting angels|right at home|brightstar|senior helpers|amedisys|addus|bayada|maxim healthcare|interim healthcare|kindred|encompass|lhc group|elara caring|aveanna|pennant|visiting nurse|vna|caring hands? of america|seniorbridge|centerwell|humana)\b/i;
const NON_MEDICAL = /home ?care|companion|personal care|senior care|seniors?\b|in-?home|caregiv|care ?giver|homemaker|non-?medical|home services|aides?\b|assisted living/i;
const MEDICAL = /home health|skilled|nursing|hospice|medical|rehab|therap|infusion|clinical|physician/i;

export type Evaluation = { keep: true; adjust: number; reasons: string[] } | { keep: false; reason: string };

export function classifyHomecareName(...names: (string | null | undefined)[]): Evaluation {
  const text = names.filter(Boolean).join(' | ');
  if (!text.trim()) return { keep: false, reason: 'no name' };
  if (INSTITUTION.test(text)) return { keep: false, reason: 'institution (hospital/system/university/government)' };
  let adjust = 0;
  const reasons: string[] = [];
  if (CHAIN.test(text)) { adjust -= 15; reasons.push('-15: name matches a national home-care chain or franchise'); }
  const nonMed = NON_MEDICAL.test(text);
  const med = MEDICAL.test(text);
  if (nonMed && !med) { adjust += 8; reasons.push('+8: name reads like non-medical home care'); }
  else if (med && !nonMed) { adjust -= 8; reasons.push('-8: name reads like a medical/skilled home health agency (registry has no non-medical flag)'); }
  return { keep: true, adjust, reasons };
}

export function evaluateIlRow(r: IlRow, now = new Date()): Evaluation {
  if (!r.license_number?.trim() || !r.facility_name?.trim()) return { keep: false, reason: 'missing name or licence' };
  const exp = r.exp_date ? new Date(r.exp_date.endsWith('Z') ? r.exp_date : `${r.exp_date}Z`) : null;
  if (!exp || Number.isNaN(exp.getTime()) || exp.getTime() < now.getTime()) return { keep: false, reason: 'licence expired' };
  const cls = classifyHomecareName(r.facility_name);
  if (!cls.keep) return cls;
  if (!formatUsPhone(r.phone)) return { keep: true, adjust: cls.adjust - 5, reasons: [...cls.reasons, '-5: no usable phone in the registry record'] };
  return cls;
}

export function evaluateNyRow(r: NyRow): Evaluation {
  if (!r.license_number?.trim() || !(r.agency ?? r.dba)?.trim()) return { keep: false, reason: 'missing name or licence' };
  if (r.registration_status !== 'Yes') return { keep: false, reason: 'not currently registered' };
  const cls = classifyHomecareName(r.agency, r.dba);
  if (!cls.keep) return cls;
  // No phone exists in this dataset, so there is no phone penalty.
  return { keep: true, adjust: cls.adjust, reasons: cls.reasons };
}

export function toIlLead(r: IlRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const { legal, dba } = splitDba(r.facility_name as string);
  const name = titleCase(dba ?? legal);
  const legalName = dba ? titleCase(legal) : null;
  const location = cityState(r.city, 'IL');
  const typeLabel = 'licensed home health agency';
  const licenseId = (r.license_number as string).trim();
  const phone = formatUsPhone(r.phone);
  return {
    sourceKey: `homecare:il:${licenseId}`,
    name, legalName, city: r.city ? titleCase(r.city) : null, state: 'IL', phone, licenseId,
    registryName: IL_REGISTRY, typeLabel, contactName: r.contact_name?.trim() || null, location,
    description: describeRegistryLead({ typeLabel, registryName: IL_REGISTRY, location, legalName, name }),
    signalDetail: `IL IDPH home health agency licence ${licenseId}${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust, reasons: ev.reasons,
  };
}

export function toNyLead(r: NyRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const agency = (r.agency ?? '').trim();
  const dba = (r.dba ?? '').trim();
  const useDba = dba && dba.toLowerCase().replace(/[^a-z0-9]/g, '') !== agency.toLowerCase().replace(/[^a-z0-9]/g, '');
  const name = titleCase(useDba ? dba : agency || dba);
  const legalName = useDba && agency ? titleCase(agency) : null;
  const location = cityState(r.city, 'NY');
  const typeLabel = 'licensed home care services agency';
  const licenseId = (r.license_number as string).trim();
  return {
    sourceKey: `homecare:ny:${licenseId}`,
    name, legalName, city: r.city ? titleCase(r.city) : null, state: 'NY', phone: null, licenseId,
    registryName: NY_REGISTRY, typeLabel, contactName: null, location,
    description: describeRegistryLead({ typeLabel, registryName: NY_REGISTRY, location, legalName, name }),
    signalDetail: `NY DOH licensed home care services agency ${licenseId} (no phone in registry)`,
    adjust: ev.adjust, reasons: ev.reasons,
  };
}

const DAY_MS = 86_400_000;

// Two of every three days use Illinois (has phone numbers), one uses New York.
// One request per dataset, whole list, then a rotating walk that skips known leads.
export async function findHomecareCandidates(
  max: number, opts: { now?: Date; startOverride?: number; source?: 'il' | 'ny'; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const result = emptyResult();
  const day = Math.floor(now.getTime() / DAY_MS);
  const source = opts.source ?? (day % 3 === 2 ? 'ny' : 'il');
  try {
    if (source === 'il') {
      const rows = await socrataGet<IlRow>(IL_HOST, IL_DATASET, {
        $where: `exp_date > '${now.toISOString().slice(0, 19)}'`, $order: 'license_number', $limit: '800',
        $select: 'facility_name,address,city,county,zip,contact_name,phone,license_number,exp_date',
      }, log);
      result.scanned = rows.length;
      const start = opts.startOverride ?? (day * max) % Math.max(1, rows.length);
      for (let i = 0; i < rows.length && result.candidates.length < max; i++) {
        const r = rows[(start + i) % rows.length];
        if (opts.isKnown?.(`homecare:il:${(r.license_number ?? '').trim()}`)) { reject(result, 'already known'); continue; }
        const ev = evaluateIlRow(r, now);
        if (!ev.keep) { reject(result, ev.reason); continue; }
        result.candidates.push(toIlLead(r, ev));
      }
    } else {
      const rows = await socrataGet<NyRow>(NY_HOST, NY_DATASET, {
        $where: "registration_status='Yes'", $order: 'license_number', $limit: '1600',
        $select: 'license_number,agency,dba,address,city,state,zip_code,registration_status',
      }, log);
      result.scanned = rows.length;
      const start = opts.startOverride ?? (day * max) % Math.max(1, rows.length);
      for (let i = 0; i < rows.length && result.candidates.length < max; i++) {
        const r = rows[(start + i) % rows.length];
        if (opts.isKnown?.(`homecare:ny:${(r.license_number ?? '').trim()}`)) { reject(result, 'already known'); continue; }
        const ev = evaluateNyRow(r);
        if (!ev.keep) { reject(result, ev.reason); continue; }
        result.candidates.push(toNyLead(r, ev));
      }
    }
  } catch (e) {
    result.errors.push(`homecare ${source}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
