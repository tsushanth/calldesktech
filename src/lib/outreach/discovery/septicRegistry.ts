import * as cheerio from 'cheerio';
import { politeFetchText, sleep as politeSleep } from './http';
import { socrataGet } from './socrata';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';
import {
  fetchDeRows, fetchMoSepticRows, collapseDeByCompany, deCompanyKey, evaluateDeRow, toDeLead, evaluateMoRow, toMoLead,
  type DeRow, type MoRow,
} from './septicDelawareMissouri';

// Septic discovery from two public registries, neither with email:
//  (a) Florida Department of Health "Active Registered and Master Septic Tank
//      Contractors": one static HTML page (~630 rows), parsed once per process
//      and cached. Rows are per PERSON (several people can share one business
//      authorization, COA), so we collapse to one lead per COA.
//  (b) City of Austin licensed liquid waste haulers (Socrata pbam-er2r, 67 rows).

export const FL_URL = 'https://ww10.doh.state.fl.us/pub/bos/Contractors/ContractorListing.html';
export const AUSTIN_HOST = 'data.austintexas.gov';
export const AUSTIN_DATASET = 'pbam-er2r';
const FL_REGISTRY = 'Florida Department of Health';
const ATX_REGISTRY = 'City of Austin';

export interface FlRow {
  county: string;
  cor: string | null; // person registration/master number, e.g. SR0991458
  coa: string | null; // business authorization number, e.g. SA0991011
  level: 'M' | 'R' | string; // Master or Registered
  person: string;
  business: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  expires: string | null; // ISO date
}

function cellLines($: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0]): string[] {
  const c = $(el).clone();
  c.find('br').replaceWith('\n');
  return c.text().replace(/ /g, ' ').split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function mdyToIso(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

export function parseFlContractors(html: string): FlRow[] {
  const $ = cheerio.load(html);
  const rows: FlRow[] = [];
  $('tr').each((_, tr) => {
    const tds = $(tr).children('td');
    if (tds.length < 7) return; // header row uses <th>
    const ids = cellLines($, tds[1]);
    const names = cellLines($, tds[3]);
    const addr = cellLines($, tds[4]);
    const cs = /^(.*?),\s*([A-Z]{2})\s+(\d{5})/.exec(addr[addr.length - 1] ?? '');
    const person = names[0] ?? '';
    if (!person) return;
    rows.push({
      county: cellLines($, tds[0])[0] ?? '',
      cor: ids.find((i) => /^S[RM]\d+/i.test(i)) ?? null,
      coa: ids.find((i) => /^SA\d+/i.test(i)) ?? null,
      level: (cellLines($, tds[2])[0] ?? '').toUpperCase(),
      person,
      business: names[1] ?? null,
      street: addr.length > 1 ? addr[0] : null,
      city: cs ? cs[1] : null,
      state: cs ? cs[2] : null,
      zip: cs ? cs[3] : null,
      phone: cellLines($, tds[5])[0] ?? null,
      expires: mdyToIso(cellLines($, tds[6])[0] ?? ''),
    });
  });
  return rows;
}

export type Evaluation = { keep: true; adjust: number; reasons: string[] } | { keep: false; reason: string };

// Waste/plumbing majors and franchises: skip. (Small independent septic firms are the target.)
const BIG_SEPTIC = /\b(roto[- ]?rooter|mr\.? rooter|waste management|republic services|wm\b|progressive waste|waste connections|liberty tax|terminix|orkin)\b/i;

export function evaluateFlRow(r: FlRow, now = new Date()): Evaluation {
  if (!r.expires || new Date(`${r.expires}T23:59:59Z`).getTime() < now.getTime()) return { keep: false, reason: 'registration expired' };
  if (r.state !== 'FL') return { keep: false, reason: 'business address not in Florida' };
  const coaOrCor = r.coa ?? r.cor;
  if (!coaOrCor) return { keep: false, reason: 'no authorization number' };
  if (!r.business) return { keep: false, reason: 'no business name (individual only)' };
  if (BIG_SEPTIC.test(r.business)) return { keep: false, reason: 'national/franchise name' };
  const reasons: string[] = [];
  let adjust = 0;
  if (r.level === 'M') { adjust += 3; reasons.push('+3: Master septic tank contractor (established operator)'); }
  if (!formatUsPhone(r.phone)) { adjust -= 5; reasons.push('-5: no usable phone in the registry record'); }
  return { keep: true, adjust, reasons };
}

export function toFlLead(r: FlRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const name = titleCase(r.business as string);
  const id = (r.coa ?? r.cor) as string;
  const location = cityState(r.city, r.state);
  const typeLabel = r.level === 'M' ? 'master septic tank contractor' : 'registered septic tank contractor';
  const phone = formatUsPhone(r.phone);
  return {
    sourceKey: `septic:fl:${id.toUpperCase()}`,
    name, legalName: null, city: r.city ? titleCase(r.city) : null, state: r.state, phone, licenseId: id,
    registryName: FL_REGISTRY, typeLabel, contactName: null, location,
    description: describeRegistryLead({ typeLabel, registryName: FL_REGISTRY, location, legalName: null, name }),
    signalDetail: `FL DOH septic contractor ${id} (${r.level === 'M' ? 'master' : 'registered'}), expires ${r.expires}${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust, reasons: ev.reasons,
  };
}

// One lead per business authorization: several licensed people share a COA.
export function collapseFlByBusiness(rows: FlRow[]): FlRow[] {
  const by = new Map<string, FlRow>();
  for (const r of rows) {
    const key = (r.coa ?? r.cor ?? '').toUpperCase();
    if (!key) continue;
    const prev = by.get(key);
    // Keep the freshest registration for the business; on a tie prefer the Master.
    if (!prev || (r.expires ?? '') > (prev.expires ?? '') || ((r.expires ?? '') === (prev.expires ?? '') && prev.level !== 'M' && r.level === 'M')) by.set(key, r);
  }
  return [...by.values()];
}

export interface AustinRow { business_name?: string; address_1?: string; city?: string; zip?: string; phone?: string; lwd_id?: string }

export function evaluateAustinRow(r: AustinRow): Evaluation {
  if (!r.business_name?.trim() || !r.lwd_id?.trim()) return { keep: false, reason: 'missing name or id' };
  if (BIG_SEPTIC.test(r.business_name)) return { keep: false, reason: 'national/franchise name' };
  const phone = formatUsPhone(r.phone);
  return { keep: true, adjust: phone ? 0 : -5, reasons: phone ? [] : ['-5: no usable phone in the registry record'] };
}

// "ALL CENTEX SEPTIC & DRAIN INC (ALL CEN TEX INC.)" -> display "All Centex Septic & Drain Inc", legal "(ALL CEN TEX INC.)" ignored.
export function toAustinLead(r: AustinRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const name = titleCase((r.business_name as string).replace(/\s*\(.*\)\s*$/, '').trim());
  const id = (r.lwd_id as string).trim();
  const location = cityState(r.city, 'TX');
  const typeLabel = 'licensed liquid waste hauler';
  const phone = formatUsPhone(r.phone);
  return {
    sourceKey: `septic:atx:${id}`,
    name, legalName: null, city: r.city ? titleCase(r.city) : null, state: 'TX', phone, licenseId: id,
    registryName: ATX_REGISTRY, typeLabel, contactName: null, location,
    description: describeRegistryLead({ typeLabel, registryName: ATX_REGISTRY, location, legalName: null, name }),
    signalDetail: `Austin liquid waste hauler ${id}${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust, reasons: ev.reasons,
  };
}

let flCache: { at: number; rows: FlRow[] } | null = null;
const FL_TTL_MS = 6 * 60 * 60_000;

export async function loadFlContractors(): Promise<FlRow[]> {
  if (flCache && Date.now() - flCache.at < FL_TTL_MS) return flCache.rows;
  // The FL DOH host serves an incomplete TLS chain (Node rejects it: UNABLE_TO_VERIFY_LEAF_SIGNATURE),
  // so fall back to the same public static page over plain HTTP. Read-only public data; the
  // parse sanity check below guards against a garbled/tampered page. TLS verification is never disabled.
  let res = await politeFetchText(FL_URL, 30_000);
  if (!res.ok || res.text.length < 5000) res = await politeFetchText(FL_URL.replace('https://', 'http://'), 30_000);
  if (!res.ok || res.text.length < 5000) throw new Error(`FL DOH page unavailable (HTTP ${res.status})`);
  const rows = collapseFlByBusiness(parseFlContractors(res.text));
  if (rows.length < 50) throw new Error(`FL DOH parse returned only ${rows.length} rows; page layout may have changed`);
  flCache = { at: Date.now(), rows };
  return rows;
}

const SLOT_MS = 60 * 60_000;

// Four sources, rotated by hourly slot: Florida (by far the largest) takes two
// slots in four, Delaware one (the only septic list with emails), and the fourth
// alternates Austin and Missouri. Every list is walked from a slot-rotating
// start and skips leads we already hold.
export type SepticSource = 'fl' | 'atx' | 'de' | 'mo';

export function septicSourceForSlot(slot: number): SepticSource {
  const m = ((slot % 4) + 4) % 4;
  if (m === 0 || m === 1) return 'fl';
  if (m === 2) return 'de';
  return ((slot % 8) + 8) % 8 === 3 ? 'atx' : 'mo';
}

export async function findSepticCandidates(
  max: number, opts: { now?: Date; startOverride?: number; source?: SepticSource; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const result = emptyResult();
  const slot = Math.floor(now.getTime() / SLOT_MS);
  const source = opts.source ?? septicSourceForSlot(slot);
  try {
    if (source === 'de' || source === 'mo') {
      const rows = source === 'de' ? collapseDeByCompany(await fetchDeRows(log)) : await fetchMoSepticRows(log);
      result.scanned = rows.length;
      if (!rows.length) throw new Error('no rows returned');
      const start = opts.startOverride ?? (slot * max) % rows.length;
      for (let i = 0; i < rows.length && result.candidates.length < max; i++) {
        const r = rows[(start + i) % rows.length];
        if (source === 'de') {
          const de = r as DeRow;
          if (opts.isKnown?.(`septic:de:${deCompanyKey(de)}`)) { reject(result, 'already known'); continue; }
          const ev = evaluateDeRow(de);
          if (!ev.keep) { reject(result, ev.reason); continue; }
          result.candidates.push(toDeLead(de, ev));
        } else {
          const mo = r as MoRow;
          if (opts.isKnown?.(`septic:mo:${(mo.installer_id ?? '').trim()}`)) { reject(result, 'already known'); continue; }
          const ev = evaluateMoRow(mo, now);
          if (!ev.keep) { reject(result, ev.reason); continue; }
          result.candidates.push(toMoLead(mo, ev));
        }
      }
    } else if (source === 'fl') {
      const all = (await loadFlContractors()).filter((r) => r.state === 'FL');
      result.scanned = all.length;
      const start = opts.startOverride ?? (slot * max) % Math.max(1, all.length);
      for (let i = 0; i < all.length && result.candidates.length < max; i++) {
        const r = all[(start + i) % all.length];
        if (opts.isKnown?.(`septic:fl:${(r.coa ?? r.cor ?? '').toUpperCase()}`)) { reject(result, 'already known'); continue; }
        const ev = evaluateFlRow(r, now);
        if (!ev.keep) { reject(result, ev.reason); continue; }
        result.candidates.push(toFlLead(r, ev));
      }
    } else {
      await politeSleep(200);
      const rows = await socrataGet<AustinRow>(AUSTIN_HOST, AUSTIN_DATASET, { $order: 'lwd_id', $limit: '200' }, log);
      result.scanned = rows.length;
      const start = opts.startOverride ?? (slot * max) % Math.max(1, rows.length);
      for (let i = 0; i < rows.length && result.candidates.length < max; i++) {
        const r = rows[(start + i) % rows.length];
        if (opts.isKnown?.(`septic:atx:${(r.lwd_id ?? '').trim()}`)) { reject(result, 'already known'); continue; }
        const ev = evaluateAustinRow(r);
        if (!ev.keep) { reject(result, ev.reason); continue; }
        result.candidates.push(toAustinLead(r, ev));
      }
    }
  } catch (e) {
    result.errors.push(`septic ${source}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
