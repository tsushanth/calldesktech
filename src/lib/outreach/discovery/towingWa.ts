import { socrataGet } from './socrata';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';

// Towing discovery from the Washington State Department of Licensing's open
// data (Socrata dataset ucdg-xgbj on data.wa.gov, "Business Licenses Related to
// the Transportation Industry"). "Registered Tow Truck Operator" is a COMPANY
// registration (legal business name + trade name + location + phone), which is
// what we need. We deliberately do NOT use Texas TDLR (7358-krk7): its tow
// licences are per-individual tow-truck-operator (driver) licences with no
// phone or street address, and it holds no company records.

export const WA_HOST = 'data.wa.gov';
export const WA_DATASET = 'ucdg-xgbj';
const REGISTRY_NAME = 'Washington State Department of Licensing';

export interface WaLicenseRow {
  license_type?: string;
  license_number?: string;
  license_status?: string;
  expiration_date?: string;
  first_issue_date?: string;
  location_name?: string;
  location_city?: string;
  location_state?: string;
  business_name?: string;
  phone_number?: string;
}

// Insurer / auction / dispatch-network names: not the small independent
// operators we want. Hard skip on a hit.
const BIG_TOW = /\b(agero|copart|insurance auto auctions|\biaa\b|urgent\.?ly|swoop|honk|allstate|geico|state farm|united road|roadside assistance|pacific northwest towing association)\b/i;
const SMALL_HINT = /family|independent|owner|since (19|20)\d\d/i;

export function isBigTowName(...names: (string | null | undefined)[]): boolean {
  return names.some((n) => !!n && BIG_TOW.test(n));
}

export type Evaluation = { keep: true; adjust: number; reasons: string[] } | { keep: false; reason: string };

export function evaluateWaTow(row: WaLicenseRow, now = new Date()): Evaluation {
  if (row.license_type !== 'Registered Tow Truck Operator') return { keep: false, reason: 'not a registered tow truck operator (HQ) record' };
  if (row.license_status !== 'Active') return { keep: false, reason: 'licence not active' };
  const exp = row.expiration_date ? new Date(row.expiration_date) : null;
  if (!exp || Number.isNaN(exp.getTime()) || exp.getTime() < now.getTime()) return { keep: false, reason: 'licence expired' };
  if (!row.license_number?.trim()) return { keep: false, reason: 'no licence number' };
  if (!(row.location_name || row.business_name)?.trim()) return { keep: false, reason: 'no business name' };
  if (isBigTowName(row.location_name, row.business_name)) return { keep: false, reason: 'insurer/auction/network name' };
  const phone = formatUsPhone(row.phone_number);
  const adjust = phone ? 0 : -5;
  const reasons = phone ? [] : ['-5: no phone in the registry record'];
  if (SMALL_HINT.test(`${row.location_name} ${row.business_name}`)) return { keep: true, adjust: adjust + 5, reasons: [...reasons, '+5: name suggests a small or family business'] };
  return { keep: true, adjust, reasons };
}

export function toWaLead(row: WaLicenseRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const trade = titleCase((row.location_name || row.business_name || '').trim());
  const legal = row.business_name ? titleCase(row.business_name.trim()) : null;
  const city = row.location_city?.trim() || null;
  const state = row.location_state?.trim() || 'WA';
  const location = cityState(city, state);
  const phone = formatUsPhone(row.phone_number);
  const licenseId = (row.license_number as string).trim();
  const typeLabel = 'registered tow truck operator';
  return {
    sourceKey: `towing:wa:${licenseId}`,
    name: trade, legalName: legal, city: city ? titleCase(city) : null, state, phone, licenseId,
    registryName: REGISTRY_NAME, typeLabel, contactName: null, location,
    description: describeRegistryLead({ typeLabel, registryName: REGISTRY_NAME, location, legalName: legal, name: trade }),
    signalDetail: `WA DOL registered tow truck operator ${licenseId}${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust, reasons: ev.reasons,
  };
}

const SLOT_MS = 60 * 60_000;
const WHERE = (now: Date) => `license_type='Registered Tow Truck Operator' AND license_status='Active' AND expiration_date > '${now.toISOString().slice(0, 19)}'`;

// One request for the whole active company list (~380 rows, small fields), then
// a slot-rotating walk that skips leads we already hold (opts.isKnown), so every
// run surfaces new operators until the list is exhausted.
export async function findWaTowCandidates(
  max: number, opts: { now?: Date; startOverride?: number; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const result = emptyResult();
  try {
    const rows = await socrataGet<WaLicenseRow>(WA_HOST, WA_DATASET, {
      $where: WHERE(now), $order: 'license_number', $limit: '600',
      $select: 'license_type,license_number,license_status,expiration_date,first_issue_date,location_name,location_city,location_state,business_name,phone_number',
    }, log);
    if (!rows.length) throw new Error('no active tow operator rows returned');
    result.scanned = rows.length;
    const start = opts.startOverride ?? (Math.floor(now.getTime() / SLOT_MS) * max) % rows.length;
    for (let i = 0; i < rows.length && result.candidates.length < max; i++) {
      const r = rows[(start + i) % rows.length];
      if (opts.isKnown?.(`towing:wa:${(r.license_number ?? '').trim()}`)) { reject(result, 'already known'); continue; }
      const ev = evaluateWaTow(r, now);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      result.candidates.push(toWaLead(r, ev));
    }
  } catch (e) {
    result.errors.push(`towing wa: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
