import { cleanEmail } from './freightFmcsa';
import { DISCOVERY_UA, sleep } from './http';
import { callerPhoneExclusion } from './callerPhonePolicy';
import { scoreChildcareRow, toCapacity } from './childcareUs';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';

// Child care discovery for Nebraska and Oklahoma, two states whose licensing
// agencies publish a provider list that carries a phone (and, for Oklahoma, an
// email) but offer no open-data CSV. Mirrors childcareUs.ts (same scoring, same
// free-mail decision: keep it, score it down).
//
//   ne-childcare  Nebraska DHHS "Licensed Child Care" ArcGIS feature service,
//                 https://gis.ne.gov/Agency/rest/services/DHHS_Licensed_Child_Care/FeatureServer/0
//                 (the layer behind nebraskamap.gov/datasets/dhhs-licensed-child-care).
//                 Verified 2026-09-30: 2,726 rows, 2,707 with a 10-digit phone
//                 (99.3%), NO email column. Roster_Date on every row is
//                 2025-10-15, i.e. the list is ~11.5 months old: the service says
//                 it is refreshed "as needed" from a monthly DHHS list, and the
//                 refresh has lagged. Types: Family Child Care Home I 909, Child
//                 Care Center 699, Family Child Care Home II 527, School Age Only
//                 270, Preschool 96, plus 225 Provisional. ~462 rows are written
//                 "LAST, FIRST" (a home provider licensed in her own name).
//
//   ok-childcare  Oklahoma Human Services Child Care Locator, https://ccl.dhs.ok.gov/providers.
//                 The search page is server-rendered with the WHOLE statewide list
//                 in its __NEXT_DATA__ (2,637 providers: 1,393 centres, 1,244
//                 homes) but without contact detail; phone and email sit on each
//                 provider's detail record, read through the same Next.js data
//                 route the site's own pages use
//                 (/_next/data/<buildId>/providers/<vendorId>.json). A 40-provider
//                 random sample on 2026-09-30 had 40/40 phone and 40/40 email.
//                 That route is NOT a documented API: the buildId changes with
//                 every site deploy (it is re-read from the list page each run),
//                 and it costs one request per provider, so requests are spaced
//                 and only the rows being ingested are fetched. The detail record
//                 also carries complaint and monitoring history; this loader
//                 reads none of it and never stores it.
//
// US leads, nothing here is on the international hold.

export const NE_FEATURE_URL = 'https://gis.ne.gov/Agency/rest/services/DHHS_Licensed_Child_Care/FeatureServer/0';
export const NE_SOURCE_URL = 'https://www.nebraskamap.gov/datasets/dhhs-licensed-child-care';
export const NE_REGISTRY = 'Nebraska Department of Health and Human Services';

export const OK_LIST_URL = 'https://ccl.dhs.ok.gov/providers';
export const OK_REGISTRY = 'Oklahoma Human Services';

const LIST_NOUN_NE = 'licensed child care roster';
const LIST_NOUN_OK = 'child care locator';

// Same national chains / multi-site operators as childcareUs.ts (that list is not exported).
const CHAIN = /\b(kindercare|knowledge (beginnings|universal)|bright horizons|goddard school|primrose school|la petite academy|childtime|tutor time|learning care group|everbrook|right at school|kids ?r ?kids|sunshine house|cr[eè]me de la cr[eè]me|lightbridge academy|celebree|guidepost montessori|new horizon academy|children'?s lighthouse|cadence education|endeavor schools|the learning experience|nobel learning|childcare network|\bkla schools\b|young scholars academy of|\bymca\b|\bywca\b|boys (and|&) girls club)\b/i;

export type Evaluation = { keep: true; adjust: number; reasons: string[] } | { keep: false; reason: string };

// ---- names -----------------------------------------------------------------

// Nebraska writes the licensee as "LAST, FIRST [MIDDLE]" for a home provider and
// "TRADE NAME owned by OWNER" / "own by" / "OB" / "operated by" for many others.
const OWNED_BY = /^(.*?)\s+(?:owned by|own by|owned by:|ob|o\/b|operated by)\s+(.+)$/i;
const LAST_FIRST = /^([A-Za-z'.-]+(?: [A-Za-z'.-]+)?),\s*([A-Za-z][A-Za-z'. -]*)$/;

export function splitOwnedBy(raw: string): { trade: string; owner: string | null } {
  const m = OWNED_BY.exec(raw.trim());
  if (!m || !m[1].trim()) return { trade: raw.trim(), owner: null };
  return { trade: m[1].replace(/[-,\s]+$/, '').trim(), owner: m[2].trim() };
}

// "DILWOOD, SHARON" -> "Sharon Dilwood"; anything else is returned unchanged.
export function flipLastFirst(raw: string): { name: string; flipped: boolean } {
  const m = LAST_FIRST.exec(raw.trim());
  if (!m) return { name: raw.trim(), flipped: false };
  return { name: `${m[2].trim()} ${m[1].trim()}`, flipped: true };
}

// ---- Nebraska --------------------------------------------------------------

export interface NeChildcareRow {
  Full_Name?: string | null;
  License_Type?: string | null;
  License_Number?: string | null;
  City?: string | null;
  State?: string | null;
  County?: string | null;
  Capacity?: string | null;
  Phone?: string | null;
  Owner_Manager?: string | null;
  Roster_Date?: string | null;
  GIS_Status?: string | null;
}

const NE_TYPE_LABEL: Record<string, string> = {
  'family child care home i': 'licensed family child care home',
  'family child care home ii': 'licensed family child care home',
  'child care center': 'licensed child care center',
  'school age only child care center': 'licensed school-age child care center',
  'school age only center': 'licensed school-age child care center',
  'preschool': 'licensed preschool',
};

export function neTypeLabel(licenseType: string | null | undefined): string | null {
  const t = (licenseType ?? '').trim().toLowerCase().replace(/^provisional\s+/, '').replace(/-/g, ' ').replace(/\s+/g, ' ');
  return NE_TYPE_LABEL[t] ?? null;
}

export const NE_MAX_ROSTER_AGE_DAYS = 550;

export function evaluateNeRow(r: NeChildcareRow, now = new Date(), maxRosterAgeDays = NE_MAX_ROSTER_AGE_DAYS): Evaluation {
  const typeLabel = neTypeLabel(r.License_Type);
  if (!typeLabel) return { keep: false, reason: 'licence type not in scope' };
  if ((r.GIS_Status ?? '').trim().toLowerCase() !== 'on current roster') return { keep: false, reason: 'not on the current roster' };
  const rd = /^(\d{4})-(\d{2})-(\d{2})$/.exec((r.Roster_Date ?? '').trim());
  if (!rd) return { keep: false, reason: 'no roster date' };
  const age = (now.getTime() - Date.UTC(Number(rd[1]), Number(rd[2]) - 1, Number(rd[3]))) / 86_400_000;
  if (age > maxRosterAgeDays) return { keep: false, reason: 'roster too old to trust' };
  const license = (r.License_Number ?? '').trim();
  if (!license) return { keep: false, reason: 'no licence number' };
  const raw = (r.Full_Name ?? '').trim();
  if (!raw) return { keep: false, reason: 'no provider name' };
  const { trade, owner } = splitOwnedBy(raw);
  if (CHAIN.test(`${trade} ${owner ?? ''} ${r.Owner_Manager ?? ''}`)) return { keep: false, reason: 'national chain, franchise, or large multi-site operator' };
  const phone = formatUsPhone(r.Phone);
  if (!phone) return { keep: false, reason: 'no usable phone (this roster has no email)' };
  // The roster has no email column, so scoreChildcareRow's -10 'no contact email' applies to every
  // Nebraska lead; that is inherent to the source (these are phone-first leads), left as is so the
  // scale stays comparable with the other childcare sources.
  const score = scoreChildcareRow({ name: trade, legalName: owner ?? r.Owner_Manager, email: null, phone, capacity: toCapacity(r.Capacity) });
  return { keep: true, ...score };
}

export function toNeLead(r: NeChildcareRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const raw = (r.Full_Name ?? '').trim();
  const { trade, owner } = splitOwnedBy(raw);
  const flip = flipLastFirst(trade);
  const name = titleCase(flip.name);
  const legalName = owner ? titleCase(flip.flipped ? flipLastFirst(owner).name : owner) : null;
  const city = (r.City ?? '').trim() || null;
  const location = cityState(city, 'NE');
  const licenseId = (r.License_Number ?? '').trim().toUpperCase();
  const phone = formatUsPhone(r.Phone);
  const typeLabel = neTypeLabel(r.License_Type) ?? 'licensed child care provider';
  const capacity = toCapacity(r.Capacity);
  return {
    sourceKey: `childcare:ne:${licenseId}`,
    name,
    legalName,
    city: city ? titleCase(city) : null,
    state: 'NE',
    phone,
    // Caller-phone policy (2026-10-01): a provider licensed in her own name ("LAST, FIRST") and any family
    // child care home are run from a residence, so the registry phone is a personal line.
    callerPhoneExcluded: callerPhoneExclusion({ name, soleProprietor: flip.flipped, typeLabel }),
    licenseId,
    registryName: NE_REGISTRY,
    typeLabel,
    // The owner/manager is a named individual in a public record: signals.registry only, never a draft.
    contactName: (r.Owner_Manager ?? '').trim() ? titleCase((r.Owner_Manager ?? '').trim()) : null,
    location,
    description: describeRegistryLead({ typeLabel, registryName: NE_REGISTRY, location, legalName, name, listNoun: LIST_NOUN_NE }),
    signalDetail: `NE DHHS ${(r.License_Type ?? '').trim()} licence ${licenseId}${r.County ? `, ${titleCase(r.County)} County` : ''}${capacity ? `; capacity ${capacity}` : ''}${phone ? `; phone ${phone}` : ''}; roster ${r.Roster_Date ?? 'unknown date'}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: null,
    contactSourceUrl: null,
  };
}

// ---- Oklahoma --------------------------------------------------------------

export interface OkListRow {
  vendorId?: string;
  name?: string;
  officialDoingBusinessAs?: string;
  facilityType?: string; // 'childcare-center' | 'childcare-home'
  addressLines?: string[]; // ["2501 E ARCHER ST", "TULSA, OK 74110"]
  isSubsidyAccepted?: boolean;
}

export interface OkDetail {
  phoneNumber?: string;
  emailAddress?: string;
  directorFullName?: string;
  licenseCapacity?: number | string;
  starLevelCode?: string;
  revocationSent?: string;
  denialSent?: string;
}

const OK_TYPE_LABEL: Record<string, string> = {
  'childcare-center': 'licensed child care center',
  'childcare-home': 'licensed family child care home',
};

// "TULSA, OK 74110" -> { city: 'TULSA', state: 'OK' }
export function parseOkCityLine(lines: string[] | undefined): { city: string | null; state: string } {
  const last = (lines ?? [])[ (lines ?? []).length - 1 ] ?? '';
  const m = /^(.*?),\s*([A-Z]{2})\b/.exec(last.trim());
  return m ? { city: m[1].trim() || null, state: m[2] } : { city: null, state: 'OK' };
}

// List-level screen: no network. Detail is fetched only for rows that pass.
export function evaluateOkListRow(r: OkListRow): { keep: true } | { keep: false; reason: string } {
  if (!OK_TYPE_LABEL[(r.facilityType ?? '').trim()]) return { keep: false, reason: 'facility type not in scope' };
  if (!(r.vendorId ?? '').trim()) return { keep: false, reason: 'no vendor id' };
  const name = `${r.name ?? ''} ${r.officialDoingBusinessAs ?? ''}`.trim();
  if (!name) return { keep: false, reason: 'no provider name' };
  if (CHAIN.test(name)) return { keep: false, reason: 'national chain, franchise, or large multi-site operator' };
  return { keep: true };
}

export function evaluateOkRow(r: OkListRow, d: OkDetail): Evaluation {
  const pre = evaluateOkListRow(r);
  if (!pre.keep) return pre;
  if ((d.revocationSent ?? '').toLowerCase() === 'true' || (d.denialSent ?? '').toLowerCase() === 'true') {
    return { keep: false, reason: 'licence revocation or denial pending' };
  }
  const email = cleanEmail(d.emailAddress);
  const phone = formatUsPhone(d.phoneNumber);
  if (!email && !phone) return { keep: false, reason: 'no contact detail at all' };
  const display = (r.officialDoingBusinessAs ?? '').trim() || (r.name ?? '').trim();
  return { keep: true, ...scoreChildcareRow({ name: display, legalName: r.name, email, phone, capacity: toCapacity(String(d.licenseCapacity ?? '')) }) };
}

export function toOkLead(r: OkListRow, d: OkDetail, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const dba = (r.officialDoingBusinessAs ?? '').replace(/\s+/g, ' ').trim();
  const legalRaw = (r.name ?? '').trim();
  // Homes are listed "LAST, FIRST"; a DBA, when present, is the trading name.
  const nameRaw = dba || legalRaw;
  const flip = flipLastFirst(nameRaw);
  const name = titleCase(flip.name);
  const legalFlip = flipLastFirst(legalRaw);
  const legalName = dba && legalRaw ? titleCase(legalFlip.name) : null;
  const { city, state } = parseOkCityLine(r.addressLines);
  const location = cityState(city, state);
  const licenseId = (r.vendorId ?? '').trim().toUpperCase();
  const phone = formatUsPhone(d.phoneNumber);
  const email = cleanEmail(d.emailAddress);
  const typeLabel = OK_TYPE_LABEL[(r.facilityType ?? '').trim()];
  const capacity = toCapacity(String(d.licenseCapacity ?? ''));
  const star = (d.starLevelCode ?? '').trim();
  return {
    sourceKey: `childcare:ok:${licenseId}`,
    name,
    legalName,
    city: city ? titleCase(city) : null,
    state,
    phone,
    callerPhoneExcluded: callerPhoneExclusion({ name, soleProprietor: flip.flipped || legalFlip.flipped, homeBased: (r.facilityType ?? '').trim() === 'childcare-home', typeLabel }),
    licenseId,
    registryName: OK_REGISTRY,
    typeLabel,
    contactName: (d.directorFullName ?? '').replace(/\s+/g, ' ').trim() || null,
    location,
    description: describeRegistryLead({ typeLabel, registryName: OK_REGISTRY, location, legalName, name, listNoun: LIST_NOUN_OK }),
    signalDetail: `OK DHS child care locator ${licenseId}${capacity ? `; capacity ${capacity}` : ''}${star ? `; star level ${star}` : ''}${phone ? `; phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email,
    contactSourceUrl: email ? `${OK_LIST_URL}/${licenseId}` : null,
  };
}

// ---- network ---------------------------------------------------------------

const NE_FIELDS = 'Full_Name,License_Type,License_Number,City,State,County,Capacity,Phone,Owner_Manager,Roster_Date,GIS_Status';

export async function allNebraskaChildcareLeads(opts: { now?: Date; isKnown?: (k: string) => boolean; log?: (m: string) => void } = {}): Promise<RegistryResult> {
  const result = emptyResult();
  const now = opts.now ?? new Date();
  try {
    const rows: NeChildcareRow[] = [];
    // maxRecordCount is 2000; page with resultOffset until the service stops saying it exceeded the limit.
    for (let offset = 0; offset < 20_000; ) {
      const qs = new URLSearchParams({ where: '1=1', outFields: NE_FIELDS, returnGeometry: 'false', f: 'json', orderByFields: 'OBJECTID', resultOffset: String(offset), resultRecordCount: '2000' });
      const res = await fetch(`${NE_FEATURE_URL}/query?${qs}`, { headers: { 'User-Agent': DISCOVERY_UA, Accept: 'application/json' } });
      if (!res.ok) throw new Error(`NE feature service HTTP ${res.status}`);
      const j = (await res.json()) as { features?: { attributes: NeChildcareRow }[]; exceededTransferLimit?: boolean; error?: { message?: string } };
      if (j.error) throw new Error(`NE feature service: ${j.error.message ?? 'error'}`);
      const f = j.features ?? [];
      rows.push(...f.map((x) => x.attributes));
      if (!j.exceededTransferLimit || !f.length) break;
      offset += f.length;
    }
    if (rows.length < 500) throw new Error(`only ${rows.length} rows returned; refusing a truncated response`);
    opts.log?.(`ne childcare: ${rows.length} rows`);
    // Every row carries the same Roster_Date, so the per-row age cutoff is a cliff: the day the roster passes
    // the limit EVERY row would be rejected as 'roster too old' and the run would look like a clean zero.
    // Fail loudly instead, naming the newest date, so someone checks whether DHHS has republished.
    const newest = rows.map((x) => (x.Roster_Date ?? '').trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop();
    if (!newest) throw new Error('NE roster has no Roster_Date on any row (layout changed?)');
    const newestAge = (now.getTime() - Date.parse(`${newest}T00:00:00Z`)) / 86_400_000;
    if (newestAge > NE_MAX_ROSTER_AGE_DAYS) throw new Error(`NE roster is stale: newest Roster_Date ${newest} is ${Math.floor(newestAge)} days old (limit ${NE_MAX_ROSTER_AGE_DAYS}); refusing to ingest closed providers`);
    for (const r of rows) {
      result.scanned++;
      const ev = evaluateNeRow(r, now);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      const lead = toNeLead(r, ev);
      if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); continue; }
      result.candidates.push(lead);
    }
  } catch (e) {
    result.errors.push(`childcare ne: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

// The list page embeds the statewide list and the Next.js buildId in __NEXT_DATA__.
export function parseOkListPage(html: string): { buildId: string; providers: OkListRow[] } {
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('OK child care locator: __NEXT_DATA__ not found (site changed?)');
  const d = JSON.parse(m[1]) as { buildId?: string; props?: { pageProps?: { childcareProviders?: OkListRow[] } } };
  const providers = d.props?.pageProps?.childcareProviders;
  if (!d.buildId || !Array.isArray(providers)) throw new Error('OK child care locator: unexpected page data (site changed?)');
  return { buildId: d.buildId, providers };
}

// The Next.js buildId changes on every site deploy; a pull that spans a deploy would otherwise see a 404 on
// every detail request. `session` carries the current id and is updated when a refresh finds a new one.
export interface OkSession { buildId: string; refreshes: number }

async function refreshOkBuildId(session: OkSession): Promise<boolean> {
  if (session.refreshes >= 5) return false;
  session.refreshes++;
  try {
    const res = await fetch(OK_LIST_URL, { headers: { 'User-Agent': DISCOVERY_UA, Accept: 'text/html' } });
    if (!res.ok) return false;
    const { buildId } = parseOkListPage(await res.text());
    if (buildId === session.buildId) return false;
    session.buildId = buildId;
    return true;
  } catch { return false; }
}

export async function fetchOkDetail(session: OkSession, vendorId: string, retryMs = 1500): Promise<OkDetail | null> {
  // The data route answers an occasional spurious 404 under load; retry with a backoff before giving up. A 404
  // that persists may mean the site was redeployed, so re-read the list page once for a fresh buildId.
  for (let attempt = 0; attempt < 3; attempt++) {
    let status = 0;
    try {
      const url = `https://ccl.dhs.ok.gov/_next/data/${session.buildId}/providers/${encodeURIComponent(vendorId)}.json`;
      const res = await fetch(url, { headers: { 'User-Agent': DISCOVERY_UA, Accept: 'application/json', 'x-nextjs-data': '1' } });
      status = res.status;
      if (res.ok) {
        const j = (await res.json()) as { pageProps?: Record<string, unknown> };
        const p = j.pageProps ?? {};
        // Pick only the contact/size fields; complaints and monitoring history are deliberately never read.
        return {
          phoneNumber: p.phoneNumber as string | undefined,
          emailAddress: p.emailAddress as string | undefined,
          directorFullName: p.directorFullName as string | undefined,
          licenseCapacity: p.licenseCapacity as number | string | undefined,
          starLevelCode: p.starLevelCode as string | undefined,
          revocationSent: p.revocationSent as string | undefined,
          denialSent: p.denialSent as string | undefined,
        };
      }
    } catch { /* retry */ }
    if (status === 404 && attempt >= 1 && (await refreshOkBuildId(session))) continue;
    if (attempt < 2) await sleep(retryMs * (attempt + 1));
  }
  return null;
}

// Give up on the whole pull when this many detail requests in a row fail: that is a dead endpoint or a changed
// route, not a handful of closed providers, and carrying on would take hours to produce nothing.
export const OK_MAX_CONSECUTIVE_FAILURES = 15;
// If more than this share of detail requests ends unusable, the result is flagged as partial.
export const OK_MAX_UNUSABLE_SHARE = 0.25;

// `max` bounds how many detail records are fetched (one request each, spaced by
// `delayMs`); the bulk dry run passes Infinity. Rows already known are skipped
// BEFORE any detail request.
export async function allOkChildcareLeads(
  opts: { max?: number; delayMs?: number; retryMs?: number; startOffset?: number; isKnown?: (k: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const result = emptyResult();
  const max = opts.max ?? Infinity;
  const delayMs = opts.delayMs ?? 400;
  try {
    const res = await fetch(OK_LIST_URL, { headers: { 'User-Agent': DISCOVERY_UA, Accept: 'text/html' } });
    if (!res.ok) throw new Error(`OK child care locator HTTP ${res.status}`);
    const { buildId, providers } = parseOkListPage(await res.text());
    const session: OkSession = { buildId, refreshes: 0 };
    if (providers.length < 500) throw new Error(`only ${providers.length} providers listed; refusing a truncated page`);
    opts.log?.(`ok childcare: ${providers.length} providers listed`);
    const n = providers.length;
    const start = n ? (opts.startOffset ?? 0) % n : 0;
    let fetched = 0;
    let unusable = 0;
    let consecutive = 0;
    for (let i = 0; i < n; i++) {
      const r = providers[(start + i) % n];
      result.scanned++;
      const pre = evaluateOkListRow(r);
      if (!pre.keep) { reject(result, pre.reason); continue; }
      if (opts.isKnown?.(`childcare:ok:${(r.vendorId ?? '').trim().toUpperCase()}`)) { reject(result, 'already known'); continue; }
      if (fetched >= max) continue;
      fetched++;
      const d = await fetchOkDetail(session, (r.vendorId ?? '').trim(), opts.retryMs);
      if (fetched % 200 === 0) opts.log?.(`ok childcare: ${fetched} details fetched`);
      await sleep(delayMs);
      // A detail with neither phone nor email is as unusable as a failed request (an empty pageProps is what a
      // changed route returns with HTTP 200).
      if (!d || (!cleanEmail(d.emailAddress) && !formatUsPhone(d.phoneNumber))) {
        unusable++;
        consecutive++;
        if (consecutive >= OK_MAX_CONSECUTIVE_FAILURES) throw new Error(`${consecutive} detail requests in a row returned nothing usable (buildId ${session.buildId}); endpoint changed or down, stopping`);
      } else {
        consecutive = 0;
      }
      if (!d) { reject(result, 'detail record unavailable'); continue; }
      const ev = evaluateOkRow(r, d);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      result.candidates.push(toOkLead(r, d, ev));
    }
    if (fetched >= 20 && unusable / fetched > OK_MAX_UNUSABLE_SHARE) {
      result.errors.push(`childcare ok: ${unusable} of ${fetched} detail records unusable; result is PARTIAL`);
    }
  } catch (e) {
    result.errors.push(`childcare ok: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

export type ChildcarePlainsSource = 'ne' | 'ok';

const DAY_MS = 86_400_000;

// Per-run window: Nebraska fetches the whole roster in one request, so the
// day-rotating window is taken afterwards; Oklahoma fetches only `max` details.
export async function findPlainsChildcareCandidates(
  max: number,
  opts: { now?: Date; source?: ChildcarePlainsSource; startOverride?: number; isKnown?: (k: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const day = Math.floor(now.getTime() / DAY_MS);
  const source = opts.source ?? (day % 2 === 0 ? 'ne' : 'ok');
  if (source === 'ok') return allOkChildcareLeads({ max, startOffset: opts.startOverride ?? day * max, isKnown: opts.isKnown, log: opts.log });
  const all = await allNebraskaChildcareLeads({ now, isKnown: opts.isKnown, log: opts.log });
  const result = emptyResult();
  result.scanned = all.scanned;
  result.rejected = all.rejected;
  result.errors = all.errors;
  if (!all.candidates.length) return result;
  const start = opts.startOverride ?? (day * max) % all.candidates.length;
  for (let i = 0; i < all.candidates.length && result.candidates.length < max; i++) {
    result.candidates.push(all.candidates[(start + i) % all.candidates.length]);
  }
  return result;
}
