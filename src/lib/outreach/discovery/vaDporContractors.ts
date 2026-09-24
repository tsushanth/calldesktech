import { streamDelimitedRows } from './delimitedStream';
import { cleanEmail, isFreeMail } from './freightFmcsa';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, splitDba, type RegistryLead, type RegistryResult } from './registryCommon';

// Home-services discovery from the Virginia Department of Professional and
// Occupational Regulation "Regulant List" contractor files, linked from
// https://www.dpor.virginia.gov/RegulantLists. Four tab-delimited exports, one
// per licence class (verified 2026-09-24):
//
//   2701__crnt.txt   3,740 rows,  2,034 with an email  (Class A, board 27/01)
//   2705a__crnt.txt 30,634 rows, 25,737 with an email  (Class A contractors)
//   2705b__crnt.txt  8,407 rows,  5,636 with an email  (Class B)
//   2705c__crnt.txt 11,296 rows,  8,258 with an email  (Class C)
//
// The files are TAB-delimited with no quoting and are not UTF-8, so they go
// through delimitedStream (latin1, tab) rather than the RFC-4180 CSV reader.
//
// There is no phone column, so a lead with only a free-mail address (a large
// share of the Class B/C sole proprietors use aol/gmail) has no usable contact
// at all from this file and falls through to website discovery, exactly as the
// Delaware septic rows do.

export const VA_DPOR_FILES = ['2701', '2705a', '2705b', '2705c'] as const;
export type VaDporFile = (typeof VA_DPOR_FILES)[number];

export const VA_DPOR_REGISTRY = 'Virginia Department of Professional and Occupational Regulation';
export const VA_DPOR_LIST_URL = 'https://www.dpor.virginia.gov/RegulantLists';
const LIST_NOUN = 'contractor licence file';

export function vaDporUrl(file: VaDporFile): string {
  return `https://www.dpor.virginia.gov/sites/default/files/Records%20and%20Documents/Regulant%20List/${file}__crnt.txt`;
}

export const VA_COL = {
  occupation: 'OCCUPATION',
  certificate: 'CERTIFICATE #',
  individual: 'INDIVIDUAL NAME',
  business: 'BUSINESS NAME',
  address: 'FIRST LINE ADDRESS',
  city: 'CITY',
  state: 'STATE',
  zip: 'FIVE DIGIT ZIP CODE',
  expiration: 'EXPIRATION DATE',
  rank: 'LICENSE RANK',
  specialty: 'LICENSE SPECIALTY',
  email: 'EMAILADDRESS',
} as const;

export interface VaDporRow {
  occupation: string;
  certificate: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  expiration: string | null;
  rank: string | null;
  specialties: string[];
  email: string | null;
}

export function toVaDporRow(o: Record<string, string>): VaDporRow {
  const v = (k: string) => (o[k] ?? '').trim() || null;
  return {
    occupation: (o[VA_COL.occupation] ?? '').trim(),
    certificate: (o[VA_COL.certificate] ?? '').trim(),
    // The business name is the licence holder; sole proprietors appear with a
    // person's name in BUSINESS NAME and INDIVIDUAL NAME empty.
    name: ((o[VA_COL.business] ?? '').trim() || (o[VA_COL.individual] ?? '').trim()).replace(/\s+/g, ' '),
    address: v(VA_COL.address),
    city: v(VA_COL.city),
    state: v(VA_COL.state),
    zip: v(VA_COL.zip),
    expiration: v(VA_COL.expiration),
    rank: v(VA_COL.rank),
    // "HVA PLB " -> ['HVA','PLB']; the field is space-padded.
    specialties: (o[VA_COL.specialty] ?? '').trim().split(/\s+/).filter(Boolean).map((s) => s.toUpperCase()),
    email: v(VA_COL.email),
  };
}

// Trade specialty codes from the DPOR contractor specialty list that are the
// phone-driven HVAC / plumbing / electrical / roofing service businesses this
// vertical targets, with the words used for each in the lead description.
// Counts across the four files: ELE 7,123; HVA 4,783; PLB 4,394; GFC 3,066;
// ROC 1,640; REF 337.
const TRADE_CODES: { code: string; label: string }[] = [
  { code: 'HVA', label: 'HVAC contractor' },
  { code: 'REF', label: 'refrigeration contractor' },
  { code: 'PLB', label: 'plumbing contractor' },
  { code: 'GFC', label: 'gas fitting contractor' },
  { code: 'ELE', label: 'electrical contractor' },
  { code: 'ROC', label: 'roofing contractor' },
];

// The generic building classes. A row holding only these is kept only when the
// business NAME itself reads like one of the trades; in that case the trade is
// NOT asserted in the description (the registry does not support it) and the
// lead is described with the generic "licensed contractor" wording.
const GENERIC_CODES = new Set(['RBC', 'CBC', 'HIC', 'CIC', 'BLD']);
const TRADE_NAME_RE = /\b(hvac|heating|air ?condition|\bac\b|cooling|refrigerat|plumb|rooter|drain|sewer|electric|roof(ing|er)?|gutter|boiler|furnace)\b/i;

const GENERIC_LABEL = 'licensed contractor';

// The dry run surfaced Otis Elevator and Parsons Transportation among the ELE
// specialties: national engineering, elevator, controls and utility firms hold
// Virginia trade licences too, and none of them is a local service business.
const BIG_HOMESERVICES = /\b(roto[- ]?rooter|mr\.? rooter|mr\.? electric|one hour heating|benjamin franklin plumbing|aire serv|ars\/?rescue rooter|service experts|home depot|lowe'?s|sears|comfort systems|emcor|limbach|\bapi group\b|michels|quanta services|\bmyr group\b|bay electric|dominion energy|washington gas|appalachian power|fluor|wood group|\bghd\b|jacobs engineering|aecom|stantec|tetra tech|\bhdr\b|\bwsp\b|kimley[- ]?horn|dewberry|timmons group|froehling ?& ?robertson|otis elevator|\bkone\b|schindler|thyssen ?krupp|parsons (transportation|corporation|government|environment)|johnson controls|siemens|honeywell|carrier corp|trane|ameresco|schneider electric|whiting[- ]turner|clark construction|turner construction|skanska|\bhitt\b|davis construction|balfour beatty|sunrun|tesla|solarcity)\b/i;

export type Evaluation = { keep: true; adjust: number; reasons: string[]; typeLabel: string } | { keep: false; reason: string };

// "08/31/2027" -> Date; DPOR writes MM/DD/YYYY.
export function parseVaDate(raw: string | null | undefined): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((raw ?? '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function evaluateVaDporRow(r: VaDporRow, now = new Date()): Evaluation {
  if (!r.name) return { keep: false, reason: 'no business name' };
  if (!r.certificate) return { keep: false, reason: 'no certificate number' };
  const exp = parseVaDate(r.expiration);
  if (!exp || exp.getTime() < now.getTime()) return { keep: false, reason: 'licence expired' };
  if (BIG_HOMESERVICES.test(r.name)) return { keep: false, reason: 'national brand, franchise or large engineering firm name' };

  const trade = TRADE_CODES.find((t) => r.specialties.includes(t.code));
  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };
  let typeLabel: string;
  if (trade) {
    typeLabel = `licensed ${trade.label}`;
    add(3, `licensed for the ${trade.code} trade specialty`);
  } else if (r.specialties.some((s) => GENERIC_CODES.has(s)) && TRADE_NAME_RE.test(r.name)) {
    // Filtered in on the name, but the description stays generic.
    typeLabel = GENERIC_LABEL;
  } else {
    return { keep: false, reason: 'specialty is not an HVAC/plumbing/electrical/roofing trade' };
  }

  const email = cleanEmail(r.email);
  if (!email) add(-10, 'no published email in the licence file');
  else if (isFreeMail(email)) add(-5, 'contact is a free-mail address (no business domain to verify)');
  else add(5, 'business-domain email published in the licence file');
  // The DPOR files carry no phone column at all.
  add(-5, 'no phone in the licence file');
  // Licence rank is Virginia's own size proxy: Class A is the unlimited-value
  // licence (the dry run's Class A samples were national engineering and utility
  // contractors), Class C is capped at small jobs. This scores by the file's own
  // field instead of chasing brand names.
  const rank = (r.rank ?? '').toUpperCase();
  if (rank === 'C') add(5, 'Class C licence (small-project contractor)');
  else if (rank === 'B') add(2, 'Class B licence (mid-size contractor)');
  else if (rank === 'A') add(-8, 'Class A licence (unlimited-value contractor, often a large firm)');
  if (r.state && r.state.toUpperCase() !== 'VA') add(-5, 'licensed in Virginia but based out of state');
  return { keep: true, adjust, reasons, typeLabel };
}

export function vaSourceKey(r: VaDporRow): string {
  return `homeservices:va:${r.occupation || '27'}-${r.certificate.toUpperCase()}`;
}

export function toVaDporLead(r: VaDporRow, ev: { adjust: number; reasons: string[]; typeLabel: string }): RegistryLead {
  const { legal, dba } = splitDba(r.name);
  const name = titleCase(dba ?? legal);
  const legalName = dba ? titleCase(legal) : null;
  const state = (r.state ?? 'VA').toUpperCase();
  const location = cityState(r.city, state);
  const email = cleanEmail(r.email);
  const usable = email && !isFreeMail(email) ? email : null;
  return {
    sourceKey: vaSourceKey(r),
    name,
    legalName,
    city: r.city ? titleCase(r.city) : null,
    state,
    phone: null,
    licenseId: r.certificate.toUpperCase(),
    registryName: VA_DPOR_REGISTRY,
    typeLabel: ev.typeLabel,
    contactName: null,
    location,
    description: describeRegistryLead({ typeLabel: ev.typeLabel, registryName: VA_DPOR_REGISTRY, location, legalName, name, listNoun: LIST_NOUN }),
    signalDetail: `VA DPOR contractor licence ${r.certificate}${r.rank ? ` (class ${r.rank}` : ''}${r.rank && r.specialties.length ? `, ${r.specialties.join(' ')}` : ''}${r.rank ? ')' : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: usable,
    contactSourceUrl: usable ? VA_DPOR_LIST_URL : null,
  };
}

// ---- network ---------------------------------------------------------------

const REQUIRED = [VA_COL.certificate, VA_COL.business, VA_COL.specialty, VA_COL.email];

// Streams one file and keeps the rows that pass `evaluateVaDporRow`, capped by
// `maxRows` so a per-run window never holds 30k rows.
export async function streamVaDporLeads(
  file: VaDporFile,
  opts: { now?: Date; maxRows?: number; isKnown?: (sourceKey: string) => boolean; url?: string; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const maxRows = opts.maxRows ?? 60_000;
  const result = emptyResult();
  await streamDelimitedRows({
    url: opts.url ?? vaDporUrl(file),
    delimiter: 'tab',
    encoding: 'latin1',
    requiredColumns: REQUIRED,
    minRows: 100,
    log: opts.log,
    onRow: (o) => {
      result.scanned++;
      if (result.candidates.length >= maxRows) return false;
      const r = toVaDporRow(o);
      const ev = evaluateVaDporRow(r, now);
      if (!ev.keep) { reject(result, ev.reason); return; }
      const lead = toVaDporLead(r, ev);
      if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); return; }
      result.candidates.push(lead);
    },
  });
  return result;
}

const DAY_MS = 86_400_000;

// One file per run, rotating by day, and within the file a day-rotating window
// of `max` leads: the four files together hold ~13k trade licences and a run
// only ever ingests a few dozen.
export function vaFileForDay(day: number): VaDporFile {
  return VA_DPOR_FILES[((day % VA_DPOR_FILES.length) + VA_DPOR_FILES.length) % VA_DPOR_FILES.length];
}

export async function findVaDporCandidates(
  max: number,
  opts: { now?: Date; file?: VaDporFile; startOverride?: number; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const day = Math.floor(now.getTime() / DAY_MS);
  const file = opts.file ?? vaFileForDay(day);
  const result = emptyResult();
  try {
    const all = await streamVaDporLeads(file, { now, isKnown: opts.isKnown, log: opts.log });
    result.scanned = all.scanned;
    result.rejected = all.rejected;
    if (!all.candidates.length) return result;
    const start = opts.startOverride ?? (day * max) % all.candidates.length;
    for (let i = 0; i < all.candidates.length && result.candidates.length < max; i++) {
      result.candidates.push(all.candidates[(start + i) % all.candidates.length]);
    }
  } catch (e) {
    result.errors.push(`homeservices va ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

// Whole-population pass across all four files for the one-off bulk import.
export async function allVaDporLeads(
  opts: { now?: Date; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const result = emptyResult();
  for (const file of VA_DPOR_FILES) {
    try {
      const r = await streamVaDporLeads(file, opts);
      result.scanned += r.scanned;
      for (const [k, v] of Object.entries(r.rejected)) result.rejected[k] = (result.rejected[k] ?? 0) + v;
      result.candidates.push(...r.candidates);
    } catch (e) {
      result.errors.push(`homeservices va ${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}
