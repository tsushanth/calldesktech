import { streamDelimitedRows } from './delimitedStream';
import { cleanEmail, isFreeMail } from './freightFmcsa';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';

// Home-services discovery from the Arkansas Contractors Licensing Board roster
// export (http://aclb2.arkansas.gov/latestroster.csv — the https host does not
// answer, so the URL is deliberately http; nothing secret is sent and the parse
// sanity check below guards against a tampered or truncated body).
//
// Verified 2026-09-24: 18,231 rows, 17,927 with an email, 12,876 of them with an
// Arkansas address and the rest out-of-state contractors licensed to work in
// Arkansas (kept — the state is recorded on the lead rather than filtered).
//
// File practicalities:
//  * The real header is NOT the first line: the export opens with a title line
//    ("CLB Roster Export - 09-24-2026") and a blank line, so the header is found
//    by column names (delimitedStream.findHeader).
//  * Not UTF-8; streamed as latin1.
//  * The trade is in `Spec` (a comma-joined description list, e.g. "Heating,
//    Ventilation, Air Conditioning, Refrigeration") and `Class Desc`. 6,104 rows
//    have neither, so for those the trade is inferred from the business NAME —
//    and in that case the trade is NOT asserted in the lead description.
//  * `Name` carries a "-C" / "-R" (commercial / residential) suffix mirroring
//    the `CommResid` column; it is not part of the business name.

export const AR_CLB_CSV_URL = 'http://aclb2.arkansas.gov/latestroster.csv';
export const AR_CLB_SOURCE_URL = 'https://www.aclb.arkansas.gov/';
export const AR_CLB_REGISTRY = 'Arkansas Contractors Licensing Board';
const LIST_NOUN = 'contractor roster';

export const AR_COL = {
  id: 'ID',
  name: 'Name',
  dba: 'DBA',
  address: 'Address',
  city: 'City',
  state: 'State',
  zip: 'Zip',
  email: 'Email',
  phone: 'Phone',
  exp: 'Exp',
  classDesc: 'Class Desc',
  spec: 'Spec',
} as const;

export interface ArContractorRow {
  id: string;
  name: string;
  dba: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  email: string | null;
  phone: string | null;
  exp: string | null;
  classDesc: string | null;
  spec: string | null;
}

// "A & N ELECTRIC INC-C" -> "A & N ELECTRIC INC"
export function stripArClassSuffix(raw: string): string {
  return raw.replace(/\s*-\s*[CR]$/i, '').replace(/\s+/g, ' ').trim();
}

export function toArContractorRow(o: Record<string, string>): ArContractorRow {
  const v = (k: string) => (o[k] ?? '').trim() || null;
  return {
    id: (o[AR_COL.id] ?? '').trim(),
    name: stripArClassSuffix(o[AR_COL.name] ?? ''),
    dba: v(AR_COL.dba),
    city: v(AR_COL.city),
    state: v(AR_COL.state),
    zip: v(AR_COL.zip),
    email: v(AR_COL.email),
    phone: v(AR_COL.phone),
    exp: v(AR_COL.exp),
    classDesc: v(AR_COL.classDesc),
    spec: v(AR_COL.spec),
  };
}

// Trade wording keyed on the roster's own specialty / class descriptions.
const TRADES: { re: RegExp; label: string }[] = [
  { re: /heating|air conditioning|ventilation|refrigeration|fuel burning or heat transfer|temperature controls/i, label: 'HVAC contractor' },
  { re: /plumbing|water and sewer lines|gas fitter/i, label: 'plumbing contractor' },
  { re: /electrical/i, label: 'electrical contractor' },
  { re: /roofing|roof decks/i, label: 'roofing contractor' },
];

// Used only to filter rows whose Spec and Class Desc are both blank; never to
// word the description.
const TRADE_NAME_RE = /\b(hvac|heating|air ?condition|cooling|refrigerat|plumb(ing|er)?|rooter|drain|sewer|electric(al)?|roof(ing|er)?|gutter|boiler|furnace|mechanical)\b/i;

const GENERIC_LABEL = 'licensed contractor';

const BIG_HOMESERVICES = /\b(roto[- ]?rooter|mr\.? rooter|mr\.? electric|one hour heating|benjamin franklin plumbing|aire serv|ars\/?rescue rooter|service experts|home depot|lowe'?s|sears|comfort systems|emcor|\bapi group\b|\bmmr\b|zachry|bechtel|kiewit|entergy|black ?&? ?veatch|burns ?&? ?mcdonnell|quanta services|irby construction)\b/i;

export type Evaluation = { keep: true; adjust: number; reasons: string[]; typeLabel: string } | { keep: false; reason: string };

// The roster writes MM-DD-YYYY.
export function parseArDate(raw: string | null | undefined): Date | null {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec((raw ?? '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function evaluateArContractorRow(r: ArContractorRow, now = new Date()): Evaluation {
  if (!r.id) return { keep: false, reason: 'no licence id' };
  const name = r.dba || r.name;
  if (!name) return { keep: false, reason: 'no business name' };
  const exp = parseArDate(r.exp);
  if (!exp || exp.getTime() < now.getTime()) return { keep: false, reason: 'licence expired' };
  if (BIG_HOMESERVICES.test(name)) return { keep: false, reason: 'national brand, franchise or large industrial contractor name' };

  const stated = `${r.spec ?? ''} ${r.classDesc ?? ''}`.trim();
  const trade = stated ? TRADES.find((t) => t.re.test(stated)) : undefined;
  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };
  let typeLabel: string;
  if (trade) {
    typeLabel = `licensed ${trade.label}`;
    add(3, 'roster specialty is an HVAC/plumbing/electrical/roofing trade');
  } else if (!stated && TRADE_NAME_RE.test(name)) {
    // No specialty recorded: kept on the name, described generically.
    typeLabel = GENERIC_LABEL;
  } else {
    return { keep: false, reason: 'specialty is not an HVAC/plumbing/electrical/roofing trade' };
  }

  const email = cleanEmail(r.email);
  if (!email) add(-10, 'no published email in the roster');
  else if (isFreeMail(email)) add(-5, 'contact is a free-mail address (no business domain to verify)');
  else add(5, 'business-domain email published in the roster');
  if (!formatUsPhone(r.phone)) add(-5, 'no usable phone in the roster record');
  if (r.state && r.state.toUpperCase() !== 'AR') add(-3, 'licensed in Arkansas but based out of state');
  return { keep: true, adjust, reasons, typeLabel };
}

export function toArContractorLead(r: ArContractorRow, ev: { adjust: number; reasons: string[]; typeLabel: string }): RegistryLead {
  // The roster has an explicit DBA column, so no splitDba parsing is needed.
  const display = stripArClassSuffix(r.dba || r.name);
  const name = titleCase(display);
  const legalName = r.dba && r.name && r.dba !== r.name ? titleCase(r.name) : null;
  const state = (r.state ?? 'AR').toUpperCase();
  const location = cityState(r.city, state);
  const email = cleanEmail(r.email);
  const usable = email && !isFreeMail(email) ? email : null;
  const phone = formatUsPhone(r.phone);
  return {
    sourceKey: `homeservices:ar:${r.id.toUpperCase()}`,
    name,
    legalName,
    city: r.city ? titleCase(r.city) : null,
    state,
    phone,
    licenseId: r.id.toUpperCase(),
    registryName: AR_CLB_REGISTRY,
    typeLabel: ev.typeLabel,
    contactName: null,
    location,
    description: describeRegistryLead({ typeLabel: ev.typeLabel, registryName: AR_CLB_REGISTRY, location, legalName, name, listNoun: LIST_NOUN }),
    signalDetail: `Arkansas CLB contractor licence ${r.id}${r.spec ? ` (${r.spec.slice(0, 80)})` : ''}${phone ? `; roster phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: usable,
    contactSourceUrl: usable ? AR_CLB_SOURCE_URL : null,
  };
}

// ---- network ---------------------------------------------------------------

const REQUIRED = [AR_COL.id, AR_COL.name, AR_COL.email, AR_COL.spec];

export async function streamArContractorLeads(
  opts: { now?: Date; isKnown?: (sourceKey: string) => boolean; url?: string; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();
  await streamDelimitedRows({
    url: opts.url ?? AR_CLB_CSV_URL,
    delimiter: 'comma',
    encoding: 'latin1',
    requiredColumns: REQUIRED,
    minRows: 500,
    log: opts.log,
    onRow: (o) => {
      result.scanned++;
      const r = toArContractorRow(o);
      const ev = evaluateArContractorRow(r, now);
      if (!ev.keep) { reject(result, ev.reason); return; }
      const lead = toArContractorLead(r, ev);
      if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); return; }
      result.candidates.push(lead);
    },
  });
  return result;
}

const DAY_MS = 86_400_000;

// One pass over the roster per run, then a day-rotating window of `max` leads,
// the same shape as the Florida DFS source.
export async function findArContractorCandidates(
  max: number,
  opts: { now?: Date; startOverride?: number; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();
  try {
    const all = await streamArContractorLeads({ now, isKnown: opts.isKnown, log: opts.log });
    result.scanned = all.scanned;
    result.rejected = all.rejected;
    if (!all.candidates.length) return result;
    const day = Math.floor(now.getTime() / DAY_MS);
    const start = opts.startOverride ?? (day * max) % all.candidates.length;
    for (let i = 0; i < all.candidates.length && result.candidates.length < max; i++) {
      result.candidates.push(all.candidates[(start + i) % all.candidates.length]);
    }
  } catch (e) {
    result.errors.push(`homeservices ar: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
