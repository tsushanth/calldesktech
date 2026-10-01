import { streamDelimitedRows } from './delimitedStream';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';

// Home-services discovery from the Alabama Licensing Board for General
// Contractors full roster (public CSV linked from licensesearch.alabama.gov/genconbd:
// "Download License Verification List (CSV)").
//
// Verified 2026-09-30: 9,926 rows, 99.9% with a 10-digit phone, NO email column.
// 8,707 rows carry an expiry after the verification date (the rest expire
// 2026-03 .. 2026-09 and are skipped as expired). The roster is not only general
// contractors: the board also licenses SUBCONTRACTORS (S- licence numbers), so
// the HVAC / plumbing / electrical / roofing trades are in it. Roughly 1,150
// Alabama-based rows with a trade specialty and a phone.
//
// Caveats the lead description deliberately does not claim anything about:
//  * Alabama licenses mechanical / plumbing / electrical work above a bid
//    threshold through this board, so the population skews commercial. Scored
//    down slightly relative to a residential-service roster.
//  * Phone is the only contact channel. These leads go through website
//    discovery for an email, or phone-first follow-up.
//  * The CSV has a UTF-8 BOM and a placeholder fax value "(   )    -".

export const AL_GENCON_CSV_URL = 'https://licensesearch.alabama.gov/genconbd/FullRosterReport';
export const AL_GENCON_SOURCE_URL = 'https://licensesearch.alabama.gov/genconbd';
export const AL_GENCON_REGISTRY = 'Alabama Licensing Board for General Contractors';
const LIST_NOUN = 'licensed contractor roster';

export const AL_COL = {
  name: 'Name',
  license: 'License_Number',
  city: 'City',
  state: 'State',
  phone: 'Phone_Number',
  specialty: 'Specialty',
  expiration: 'Expiration_Date',
} as const;

export interface AlGenConRow {
  name: string;
  license: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  specialty: string;
  expiration: string | null;
}

export function toAlGenConRow(o: Record<string, string>): AlGenConRow {
  const v = (k: string) => (o[k] ?? '').replace(/^﻿/, '').trim() || null;
  return {
    name: (o[AL_COL.name] ?? '').replace(/\s+/g, ' ').trim(),
    license: (o[AL_COL.license] ?? '').trim(),
    city: v(AL_COL.city),
    state: v(AL_COL.state),
    phone: v(AL_COL.phone),
    specialty: (o[AL_COL.specialty] ?? '').replace(/\s+/g, ' ').trim(),
    expiration: v(AL_COL.expiration),
  };
}

// Matched against the WHOLE specialty string (the CSV comma-joins several
// specialties and one of them, "HEATING, VENTILATION AND AIR CONDITIONING",
// itself contains commas).
const TRADES: { re: RegExp; label: string }[] = [
  { re: /heating|ventilation|air conditioning|refrigeration|\bmechanical\b/i, label: 'HVAC contractor' },
  { re: /plumbing/i, label: 'plumbing contractor' },
  { re: /electrical(?!\s+transmission)(?!.*power line)|\belectric(?!\s+power line)\b/i, label: 'electrical contractor' },
  { re: /roofing/i, label: 'roofing contractor' },
];

const BIG_HOMESERVICES = /\b(roto[- ]?rooter|mr\.? rooter|mr\.? electric|one hour heating|benjamin franklin plumbing|aire serv|ars\/?rescue rooter|service experts|home depot|lowe'?s|sears|comfort systems|emcor|limbach|\bapi group\b|\bmmr\b|zachry|bechtel|kiewit|quanta services|\bmyr group\b|black ?&? ?veatch|burns ?&? ?mcdonnell|johnson controls|siemens|honeywell|trane|alabama power|southern company|\bdpr construction|turner construction|brasfield|robins ?& ?morton|hoar construction)\b/i;
const STAFFING = /\b(staffing|manpower|man ?power|labor ?(ready|solutions|services)|staff ?leasing|employee leasing|\bpeo\b|personnel|payroll)\b/i;

// "5/31/2027"
export function parseAlDate(raw: string | null | undefined): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((raw ?? '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
  return Number.isNaN(d.getTime()) ? null : d;
}

export type Evaluation = { keep: true; adjust: number; reasons: string[]; typeLabel: string } | { keep: false; reason: string };

export function evaluateAlGenConRow(r: AlGenConRow, now = new Date()): Evaluation {
  if (!r.license) return { keep: false, reason: 'no licence id' };
  if (!r.name) return { keep: false, reason: 'no business name' };
  const exp = parseAlDate(r.expiration);
  if (!exp || exp.getTime() < now.getTime()) return { keep: false, reason: 'licence expired' };
  if (BIG_HOMESERVICES.test(r.name)) return { keep: false, reason: 'national brand, franchise or large industrial contractor name' };
  if (STAFFING.test(r.name)) return { keep: false, reason: 'staffing, manpower or payroll company' };
  const trade = TRADES.find((t) => t.re.test(r.specialty));
  if (!trade) return { keep: false, reason: 'specialty is not an HVAC/plumbing/electrical/roofing trade' };
  const phone = formatUsPhone(r.phone);
  if (!phone) return { keep: false, reason: 'no usable phone (the roster has no email)' };

  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };
  add(3, 'roster specialty is an HVAC/plumbing/electrical/roofing trade');
  add(-10, 'no published email in the roster (phone only)');
  if (r.state && r.state.toUpperCase() !== 'AL') add(-3, 'licensed in Alabama but based out of state');
  // A board that licenses general contractors also holds the large commercial
  // firms; a general-building licence next to the trade is a size hint.
  if (/\b(BC|H\/RR|MU|BCU4|HS)\s*:/.test(r.specialty)) add(-2, 'also holds a general building / heavy / municipal licence (larger commercial firm)');
  return { keep: true, adjust, reasons, typeLabel: `licensed ${trade.label}` };
}

export function toAlGenConLead(r: AlGenConRow, ev: { adjust: number; reasons: string[]; typeLabel: string }): RegistryLead {
  const name = titleCase(r.name);
  const state = (r.state ?? 'AL').toUpperCase();
  const location = cityState(r.city, state);
  const phone = formatUsPhone(r.phone);
  const licenseId = r.license.toUpperCase();
  return {
    sourceKey: `homeservices:al:${licenseId}`,
    name,
    legalName: null,
    city: r.city ? titleCase(r.city) : null,
    state,
    phone,
    licenseId,
    registryName: AL_GENCON_REGISTRY,
    typeLabel: ev.typeLabel,
    contactName: null,
    location,
    description: describeRegistryLead({ typeLabel: ev.typeLabel, registryName: AL_GENCON_REGISTRY, location, legalName: null, name, listNoun: LIST_NOUN }),
    signalDetail: `Alabama Gen. Contractors Board licence ${licenseId} (${r.specialty.slice(0, 80)})${phone ? `; roster phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: null,
    contactSourceUrl: null,
  };
}

// ---- network ---------------------------------------------------------------

const REQUIRED = [AL_COL.name, AL_COL.license, AL_COL.phone, AL_COL.specialty, AL_COL.expiration];

export async function streamAlGenConLeads(
  opts: { now?: Date; isKnown?: (sourceKey: string) => boolean; url?: string; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();
  await streamDelimitedRows({
    url: opts.url ?? AL_GENCON_CSV_URL,
    delimiter: 'comma',
    requiredColumns: REQUIRED,
    minRows: 500,
    log: opts.log,
    onRow: (o) => {
      result.scanned++;
      const r = toAlGenConRow(o);
      const ev = evaluateAlGenConRow(r, now);
      if (!ev.keep) { reject(result, ev.reason); return; }
      const lead = toAlGenConLead(r, ev);
      if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); return; }
      result.candidates.push(lead);
    },
  });
  return result;
}

const DAY_MS = 86_400_000;

export async function findAlGenConCandidates(
  max: number,
  opts: { now?: Date; startOverride?: number; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();
  try {
    const all = await streamAlGenConLeads({ now, isKnown: opts.isKnown, log: opts.log });
    result.scanned = all.scanned;
    result.rejected = all.rejected;
    if (!all.candidates.length) return result;
    const day = Math.floor(now.getTime() / DAY_MS);
    const start = opts.startOverride ?? (day * max) % all.candidates.length;
    for (let i = 0; i < all.candidates.length && result.candidates.length < max; i++) {
      result.candidates.push(all.candidates[(start + i) % all.candidates.length]);
    }
  } catch (e) {
    result.errors.push(`homeservices al: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
