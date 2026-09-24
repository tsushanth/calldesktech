import { streamDelimitedRows } from './delimitedStream';
import {
  cityCountry, emptyResult, formatIntlPhone, reject, titleCase, type RegistryLead, type RegistryResult,
} from './registryCommon';
import { isUkCorporateName } from './ukCqcDirectory';

// Freight discovery from the UK GOODS VEHICLE OPERATOR LICENCE register, published
// by the Traffic Commissioners / DVSA as one CSV per traffic area. Open Government
// Licence, no key (verified 2026-09-24: East of England alone has 33,219 rows, of
// which 29,653 are valid Limited Company licences).
//
// EVERY lead from here is stored ON HOLD (region_blocked + signals.intlHold); see
// registryCommon.INTL_HOLD_REASON.
//
// The register publishes NO email and NO phone, so these leads go in
// contact_status 'unknown' and need the existing website -> published-email step,
// which only runs once the country has been released.
//
// PECR, again: only 'Limited Company' operators are kept. 'Sole Trader' and
// 'Partnership' operators are individuals or non-corporate partnerships, and
// emailing them would need consent. That is an OperatorType column, so unlike the
// CQC file the test is exact rather than a guess at the name — the corporate-name
// check is kept as a second, cheap sanity check on top of it.

export const DVSA_EXPORT_BASE = 'https://content.mgmt.dvsacloud.uk/olcs.app.prod.dvsa.aws/data-gov-uk-export';
export const DVSA_DATA_PAGE_URL = 'https://www.data.gov.uk/dataset/9ff92b46-41e2-4c78-9c85-6bc47e1da09a/traffic-commissioner-goods-vehicle-operator-licence-data';
export const DVSA_REGISTRY = 'Traffic Commissioners for Great Britain';
const LIST_NOUN = 'goods vehicle operator licence register';

// The eight traffic areas, each a separate CSV. Names are verbatim: they go into
// the filename, and a wrong one answers HTTP 403. Northern Ireland has its own
// licensing regime and is not in this export.
export const DVSA_REGIONS = [
  'East of England',
  'London and the South East of England',
  'North East of England',
  'North West of England',
  'Scotland',
  'Wales',
  'West Midlands',
  'West of England',
] as const;
export type DvsaRegion = (typeof DVSA_REGIONS)[number];

export function dvsaRegionUrl(region: string): string {
  return `${DVSA_EXPORT_BASE}/OLBSLicenceReport_${encodeURIComponent(region)}.csv`;
}

export const DVSA_COL = {
  region: 'GeographicRegion',
  licence: 'LicenceNumber',
  licenceType: 'LicenceType',
  operator: 'OperatorName',
  operatorType: 'OperatorType',
  correspondence: 'CorrespondenceAddress',
  oc: 'OCAddress',
  transportManager: 'TransportManager',
  vehicles: 'NumberOfVehiclesAuthorised',
  trailers: 'NumberOfTrailersAuthorised',
  director: 'DirectorOrPartner',
  status: 'LicenceStatus',
  companyReg: 'CompanyRegNumber',
} as const;

export const DVSA_REQUIRED_COLUMNS = [DVSA_COL.operator, DVSA_COL.operatorType, DVSA_COL.status, DVSA_COL.licence];

export interface DvsaRow {
  region: string | null;
  licence: string;
  licenceType: string | null;
  operator: string;
  operatorType: string;
  correspondence: string | null;
  oc: string | null;
  transportManager: string | null;
  vehicles: number | null;
  trailers: number | null;
  director: string | null;
  status: string;
  companyReg: string | null;
}

export function toDvsaRow(o: Record<string, string>): DvsaRow {
  const v = (k: string) => (o[k] ?? '').trim() || null;
  const n = (k: string) => {
    const x = Number((o[k] ?? '').trim());
    return Number.isFinite(x) ? x : null;
  };
  return {
    region: v(DVSA_COL.region),
    licence: (o[DVSA_COL.licence] ?? '').trim().toUpperCase(),
    licenceType: v(DVSA_COL.licenceType),
    operator: (o[DVSA_COL.operator] ?? '').trim().replace(/\s+/g, ' '),
    operatorType: (o[DVSA_COL.operatorType] ?? '').trim(),
    correspondence: v(DVSA_COL.correspondence),
    oc: v(DVSA_COL.oc),
    transportManager: v(DVSA_COL.transportManager),
    vehicles: n(DVSA_COL.vehicles),
    trailers: n(DVSA_COL.trailers),
    director: v(DVSA_COL.director),
    status: (o[DVSA_COL.status] ?? '').trim().toLowerCase(),
    companyReg: v(DVSA_COL.companyReg),
  };
}

// Supermarkets, parcel networks, the big 3PLs and bus/coach groups: not the small
// operators the vertical is for. The freight equivalent already exists as
// freightFmcsa.BIG_BROKER but that list is US-shaped, so this is the UK one.
const BIG_UK_FREIGHT = /\b(tesco|sainsbury|asda|morrisons|aldi|lidl|waitrose|john lewis|marks ?& ?spencer|\bm ?& ?s\b|co[- ]?operative group|iceland foods|b ?& ?q\b|screwfix|wickes|travis perkins|jewson|howdens|amazon|dhl\b|dpd\b|ups\b|fedex|tnt\b|hermes|evri\b|yodel|royal mail|parcelforce|whistl|xpo\b|gxo\b|wincanton|eddie stobart|\besl\b|culina|great bear|kuehne|db schenker|dsv\b|geodis|ceva\b|rhenus|gefco|maritime transport|turners of soham|gregory distribution|suttons\b|pd ports|stagecoach|first ?group|arriva|go[- ]ahead|national express|veolia|biffa|suez\b|serco|balfour beatty|kier\b|galliford|skanska|vinci|laing o'rourke|costain|murphy group|\bbt\b|openreach|centrica|british gas|network rail|\bmod\b|ministry of|nhs\b|\bcouncil\b|hanson|tarmac|cemex|breedon|aggregate industries|sibelco)\b/i;

export type Evaluation =
  | { keep: true; adjust: number; reasons: string[] }
  | { keep: false; reason: string };

// "  424 BUSHEY MILL LANE   BUSHEY  GB WD23 2AJ" -> "Bushey". The address is a
// run-together, space-padded single field ending in the country code and postcode,
// so the town is the last chunk before "GB <postcode>".
export function dvsaTown(address: string | null | undefined): string | null {
  // The multi-space runs are the only field separators this address has, so they
  // must survive until after the split.
  const a = (address ?? '').replace(/[\r\n\t]+/g, ' ').trimEnd();
  if (!a.trim()) return null;
  // Strip the trailing "GB <outcode> <incode>" (or just the postcode).
  const stripped = a.replace(/\s+(GB|UK|GG|JE|IM)?\s*[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\s*$/i, '').trim();
  const parts = stripped.split(/\s{2,}|,/).map((s) => s.trim()).filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : null;
  // A house number or a single letter is not a town.
  if (!last || /\d/.test(last) || last.length < 3) return null;
  return last;
}

export function evaluateDvsaRow(row: DvsaRow): Evaluation {
  if (!row.operator) return { keep: false, reason: 'no operator name' };
  if (!row.licence) return { keep: false, reason: 'no licence number' };
  if (row.status !== 'lsts_valid') return { keep: false, reason: `licence not valid (${row.status || 'unknown'})` };
  if (row.operatorType !== 'Limited Company') {
    return { keep: false, reason: `operator is a ${row.operatorType || 'unknown type'}, not a limited company (PECR consent required)` };
  }
  if (BIG_UK_FREIGHT.test(row.operator)) return { keep: false, reason: 'supermarket, parcel network, 3PL or public body' };
  // The OperatorType column already said 'Limited Company'; if the name carries no
  // corporate form at all the row is inconsistent and is skipped rather than
  // guessed at.
  if (!isUkCorporateName(row.operator)) return { keep: false, reason: 'operator name carries no corporate legal form' };

  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };

  add(3, 'holds a valid goods vehicle operator licence');
  add(2, 'operator is a limited company, so B2B email is permitted under PECR');
  if (row.licenceType && /standard international/i.test(row.licenceType)) add(3, 'standard international licence (cross-border haulage for hire or reward)');
  else if (row.licenceType && /standard/i.test(row.licenceType)) add(2, 'standard licence (haulage for hire or reward, not own-account)');
  else if (row.licenceType && /restricted/i.test(row.licenceType)) add(-5, 'restricted licence (own-account carriage only, not a haulier)');

  const v = row.vehicles ?? 0;
  if (v >= 100) add(-15, 'licensed for 100+ vehicles (too large)');
  else if (v >= 5) add(3, `licensed for ${v} vehicles (an established small fleet)`);
  else if (v > 0) add(-2, `licensed for only ${v} vehicle(s)`);

  if (row.transportManager && !/^no transport manager$/i.test(row.transportManager)) add(2, 'has a named transport manager');
  if (row.companyReg) add(1, 'registered at Companies House');

  return { keep: true, adjust, reasons };
}

export function dvsaSourceKey(licence: string): string {
  return `freight:gb-dvsa:${licence.trim().toUpperCase()}`;
}

export function toDvsaLead(row: DvsaRow, ev: Extract<Evaluation, { keep: true }>): RegistryLead {
  const name = titleCase(row.operator);
  // The operating centre is where the vehicles are kept, which is the better place
  // for the business than the correspondence address (often an accountant).
  const town = dvsaTown(row.oc) ?? dvsaTown(row.correspondence);
  const location = cityCountry(town, 'GB');
  const typeLabel = 'licensed goods vehicle operator';
  let description = `Listed in the ${DVSA_REGISTRY} ${LIST_NOUN} as a ${typeLabel}`;
  if (row.vehicles && row.vehicles > 0) description += `, licensed for ${row.vehicles} vehicle${row.vehicles === 1 ? '' : 's'}`;
  if (location) description += `, based in ${location}`;
  return {
    sourceKey: dvsaSourceKey(row.licence),
    name,
    legalName: row.operator !== name ? row.operator : null,
    city: town ? titleCase(town) : null,
    state: 'GB',
    // The register publishes no phone at all.
    phone: formatIntlPhone(null),
    licenseId: row.licence,
    registryName: DVSA_REGISTRY,
    typeLabel,
    // DirectorOrPartner is a named individual; kept on signals only, never in a draft.
    contactName: row.director,
    location,
    description: `${description}.`,
    signalDetail: `DVSA operator licence ${row.licence} (${row.licenceType ?? '?'}, ${row.region ?? '?'}), ${row.vehicles ?? 0} vehicles authorised${row.companyReg ? `, company ${row.companyReg}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: null,
    contactSourceUrl: DVSA_DATA_PAGE_URL,
    country: 'GB',
  };
}

// ---- network ---------------------------------------------------------------

export interface DvsaOpts {
  now?: Date;
  isKnown?: (sourceKey: string) => boolean;
  log?: (m: string) => void;
  regions?: readonly string[];
  // Per-region cap; the eight files are ~250k rows in total, so a bulk import
  // still bounds what it retains.
  maxPerRegion?: number;
  timeoutMs?: number;
  rowsOverride?: DvsaRow[];
}

export async function findDvsaCandidates(max: number, opts: DvsaOpts = {}): Promise<RegistryResult> {
  const result = emptyResult();
  const seen = new Set<string>();
  const perRegionCap = opts.maxPerRegion ?? Number.MAX_SAFE_INTEGER;
  let inRegion = 0;
  const take = (row: DvsaRow): boolean => {
    const key = dvsaSourceKey(row.licence);
    if (seen.has(key)) { reject(result, 'duplicate licence number'); return true; }
    if (opts.isKnown?.(key)) { seen.add(key); reject(result, 'already known'); return true; }
    const ev = evaluateDvsaRow(row);
    if (!ev.keep) { reject(result, ev.reason); return true; }
    seen.add(key);
    result.candidates.push(toDvsaLead(row, ev));
    inRegion++;
    return result.candidates.length < max && inRegion < perRegionCap;
  };
  try {
    if (opts.rowsOverride) {
      result.scanned = opts.rowsOverride.length;
      for (const row of opts.rowsOverride) if (!take(row)) break;
    } else {
      for (const region of opts.regions ?? DVSA_REGIONS) {
        if (result.candidates.length >= max) break;
        inRegion = 0;
        try {
          const { scanned } = await streamDelimitedRows({
            url: dvsaRegionUrl(region),
            delimiter: 'comma',
            requiredColumns: DVSA_REQUIRED_COLUMNS,
            minRows: 500,
            timeoutMs: opts.timeoutMs ?? 240_000,
            log: opts.log,
            onRow: (o) => take(toDvsaRow(o)),
          });
          result.scanned += scanned;
        } catch (e) {
          // One traffic area being down must not cost the run the other seven.
          result.errors.push(`uk dvsa ${region}: ${e instanceof Error ? e.message : String(e)}`);
        }
        opts.log?.(`uk dvsa ${region}: running total scanned ${result.scanned}, candidates ${result.candidates.length}`);
      }
    }
    opts.log?.(`uk dvsa: scanned ${result.scanned}, candidates ${result.candidates.length}`);
  } catch (e) {
    result.errors.push(`uk dvsa: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

export function allDvsaLeads(opts: DvsaOpts = {}): Promise<RegistryResult> {
  return findDvsaCandidates(Number.MAX_SAFE_INTEGER, opts);
}
