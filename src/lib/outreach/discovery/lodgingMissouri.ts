import { callerPhoneExclusion } from './callerPhonePolicy';
import { socrataGet } from './socrata';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';

// Lodging discovery from the Missouri Department of Health and Senior Services
// "Lodging Active" list on data.mo.gov (Socrata dataset cae7-z4c6, last updated
// 2026-06-24 when checked 2026-09-30).
//
// Verified 2026-09-30: 1,477 rows (Active 1,246, Pending 180, Closed 35, New 16),
// 1,462 with a 10-digit phone (99%). No email, no licence number, no website: the
// phone is the contact channel, so these are phone-first leads. The sibling
// dataset 7ac3-k2di (Missouri Licensed Lodging Establishment List, 1,470 rows,
// updated 2026-04-10) is an older cut of the same list with no status column;
// this loader uses the newer one that has facility_status.
//
// The list is dominated by franchise properties (Holiday Inn 60, Best Western 60,
// Super 8 66, Hampton 44, Comfort 41, Quality 41, Marriott 38, Hilton 36...).
// Those run a 24-hour front desk and a central reservation line, so they are
// hard-skipped by brand, the way qcLodging does. What remains is the independent
// motel / inn / lodge / resort / cabin tail, which is what a small AI phone agent
// actually fits.
//
// There is no id column, so the sourceKey is the normalised name + 5-digit zip.

export const MO_LODGING_HOST = 'data.mo.gov';
export const MO_LODGING_DATASET = 'cae7-z4c6';
export const MO_LODGING_SOURCE_URL = 'https://data.mo.gov/d/cae7-z4c6';
export const MO_LODGING_REGISTRY = 'Missouri Department of Health and Senior Services';
const LIST_NOUN = 'lodging list';
const TYPE_LABEL = 'licensed lodging establishment';

export interface MoLodgingRow {
  establishment_name?: string;
  establishment_address?: string;
  establishment_city?: string;
  establishment_state?: string;
  establishment_zip?: string;
  county?: string;
  telephone?: string;
  facility_status?: string;
}

// Hotel chains, franchise brands, timeshare / RV chains and travel platforms.
const BIG_LODGING = /\b(marriott|courtyard|fairfield inn|residence inn|springhill suites|towneplace|sheraton|westin|renaissance|ritz|hilton|hampton inn|hampton by|doubletree|embassy suites|homewood suites|home2|tru by|garden inn|canopy|hyatt|\bac hotel|aloft|moxy|double ?tree|four points|hawthorn|element (hotel|north|st|kansas|saint)|\bihg\b|holiday inn|candlewood|staybridge|crowne plaza|hotel indigo|avid hotel|wyndham|days inn|super ?8|ramada|howard johnson|travelodge|knights inn|baymont|microtel|wingate|la quinta|choice hotels|comfort (inn|suites)|quality (inn|suites)|clarion|sleep inn|econo ?lodge|rodeway|cambria|mainstay|suburban (extended|studios)|woodspring|extended stay|sonesta|red roof|motel 6|studio 6|\bgreen tree\b|america'?s best value|americas best value|budget host|best western|surestay|sure ?stay|drury|radisson|country inn|park inn|spring ?hill suites|town?e? ?place suites|\btru springfield|\bvib springfield|pear tree inn|le meridien|four seasons hotel|intercontinental|loews|casino|red lion|americinn|amerihost|ameristar|cobblestone inn|americas? value inn|america'?s value inn|\bymca\b|\bkoa\b|kampgrounds|jellystone|great wolf|margaritaville|\bvrbo\b|airbnb|booking\.com|expedia|vacasa|state park|conservation area|corps of engineers|city of)\b/i;

export type Evaluation = { keep: true; adjust: number; reasons: string[] } | { keep: false; reason: string };

export function moLodgingId(r: Pick<MoLodgingRow, 'establishment_name' | 'establishment_zip'>): string {
  const slug = (r.establishment_name ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const zip = (r.establishment_zip ?? '').replace(/\D/g, '').slice(0, 5);
  return `${slug}-${zip || 'nozip'}`;
}

export function evaluateMoLodgingRow(r: MoLodgingRow): Evaluation {
  const name = (r.establishment_name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { keep: false, reason: 'no establishment name' };
  if ((r.facility_status ?? '').trim().toLowerCase() !== 'active') return { keep: false, reason: 'status is not Active' };
  if (BIG_LODGING.test(name)) return { keep: false, reason: 'hotel chain, franchise brand, platform or public site' };
  const phone = formatUsPhone(r.telephone);
  if (!phone) return { keep: false, reason: 'no usable phone (this list has no email)' };
  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };
  add(-10, 'no published email in the lodging list (phone-first lead)');
  if (/\b(motel|lodge|cabins?|cottages?|campground|inn)\b/i.test(name)) add(3, 'name suggests an independent motel/inn/lodge rather than a branded hotel');
  return { keep: true, adjust, reasons };
}

export function toMoLodgingLead(r: MoLodgingRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const name = titleCase((r.establishment_name ?? '').replace(/\s+/g, ' ').trim());
  const city = (r.establishment_city ?? '').trim() || null;
  const state = ((r.establishment_state ?? '').trim() || 'MO').toUpperCase();
  const location = cityState(city, state);
  const phone = formatUsPhone(r.telephone);
  const id = moLodgingId(r);
  return {
    sourceKey: `lodging:mo:${id}`,
    name,
    legalName: null,
    city: city ? titleCase(city) : null,
    state,
    phone,
    // Caller-phone policy (2026-10-01): a lodging licensed under a person's name is a sole proprietor's line.
    callerPhoneExcluded: callerPhoneExclusion({ name }),
    licenseId: id,
    registryName: MO_LODGING_REGISTRY,
    typeLabel: TYPE_LABEL,
    contactName: null,
    location,
    description: describeRegistryLead({ typeLabel: TYPE_LABEL, registryName: MO_LODGING_REGISTRY, location, legalName: null, name, listNoun: LIST_NOUN }),
    signalDetail: `MO DHSS lodging list, active${r.county ? `, ${titleCase(r.county)} County` : ''}${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: null,
    contactSourceUrl: null,
  };
}

// ---- network ---------------------------------------------------------------

export async function allMoLodgingLeads(opts: { isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {}): Promise<RegistryResult> {
  const result = emptyResult();
  try {
    const rows = await socrataGet<MoLodgingRow>(MO_LODGING_HOST, MO_LODGING_DATASET, {
      $select: 'establishment_name,establishment_address,establishment_city,establishment_state,establishment_zip,county,telephone,facility_status',
      $limit: '5000',
      $order: ':id',
    }, opts.log);
    if (rows.length >= 5000) throw new Error('hit the 5000-row $limit; the list needs paging, refusing a possibly truncated pull');
    if (rows.length < 200) throw new Error(`only ${rows.length} rows returned; refusing a truncated response`);
    const seen = new Set<string>();
    for (const r of rows) {
      result.scanned++;
      const ev = evaluateMoLodgingRow(r);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      const lead = toMoLodgingLead(r, ev);
      if (seen.has(lead.sourceKey)) { reject(result, 'duplicate name and zip in the list'); continue; }
      seen.add(lead.sourceKey);
      if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); continue; }
      result.candidates.push(lead);
    }
  } catch (e) {
    result.errors.push(`lodging mo: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

const DAY_MS = 86_400_000;

export async function findMoLodgingCandidates(
  max: number,
  opts: { now?: Date; startOverride?: number; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const all = await allMoLodgingLeads({ isKnown: opts.isKnown, log: opts.log });
  const result = emptyResult();
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
