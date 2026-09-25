import { cleanEmail, isFreeMail } from './freightFmcsa';
import { DISCOVERY_UA, sleep } from './http';
import {
  cityCountry, emptyResult, formatIntlPhone, reject, titleCase, type RegistryLead, type RegistryResult,
} from './registryCommon';

// Child-care discovery from the SINGAPORE ECDA (Early Childhood Development
// Agency) list of licensed child care centres, published on data.gov.sg through
// the CKAN datastore API. No key, Singapore Open Data Licence.
//
// Verified live 2026-09-24: 1,871 centres, each with centre_name,
// centre_contact_no, centre_email_address, centre_address, postal_code,
// centre_website and organisation_description.
//
// RATE LIMITING. data.gov.sg answers a burst of datastore_search pages with
// TOO_MANY_REQUESTS rather than a 429 status, so a failed page looks like a
// successful HTTP response carrying an error body. parseSgPage therefore treats an
// error body as an error, and the walk pauses between pages and retries a
// rate-limited page with a growing back-off instead of skipping it — skipping is
// how a source silently imports two thirds of itself.
//
// CHAINS. This is the one filter that matters here. Singapore's childcare market is
// dominated by a handful of large anchor operators and NGOs — NTUC First Campus
// (My First Skool), PCF Sparkletots, MOE Kindergartens, E-Bridge, Skool4Kidz — and
// one of those runs hundreds of centres from a head office. They are filtered two
// ways: by the childcare vertical's own chain vocabulary (SG_CHAINS below, the
// local equivalent of products.ts's KinderCare/Bright Horizons list), and
// structurally, by counting how many centres share an organisation_code and
// dropping any operator above SG_MAX_CENTRES_PER_ORG. The structural test is what
// catches next year's chain, which no word list will contain.
//
// COUNTRY AND LANGUAGE: `country` is SG, so the international hold applies and
// `COUNTRY=SG tsx release-country.ts` releases them. English is the deliberate
// draft language (language.ts lists SG as English on purpose, not as a gap).
//
// EVERY lead from here is stored ON HOLD (region_blocked + signals.intlHold).

export const SG_ECDA_RESOURCE_ID = 'd_696c994c50745b079b3684f0e90ffc53';
export const SG_ECDA_API = 'https://data.gov.sg/api/action/datastore_search';
export const SG_ECDA_DATASET_PAGE = `https://data.gov.sg/datasets/${SG_ECDA_RESOURCE_ID}/view`;
export const SG_ECDA_REGISTRY = 'Singapore Early Childhood Development Agency (ECDA) list of licensed child care centres';

// An operator running more than this many centres is a chain with a head office,
// not a centre whose own phone the leader answers. Verified against the live data:
// this keeps the independents and the two- and three-centre operators and drops the
// anchor operators.
export const SG_MAX_CENTRES_PER_ORG = 3;

export function sgEcdaPageUrl(limit: number, offset: number): string {
  const p = new URLSearchParams({ resource_id: SG_ECDA_RESOURCE_ID, limit: String(limit), offset: String(offset) });
  return `${SG_ECDA_API}?${p.toString()}`;
}

export interface SgEcdaRow {
  centreCode: string;
  orgCode: string | null;
  orgDescription: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  postcode: string | null;
  website: string | null;
  serviceModel: string | null;
}

export function toSgEcdaRow(o: Record<string, unknown>): SgEcdaRow {
  const v = (k: string) => {
    const x = o[k];
    const s = typeof x === 'string' ? x.trim() : x == null ? '' : String(x).trim();
    // The export writes a literal "na" for a missing value.
    return !s || s.toLowerCase() === 'na' ? null : s;
  };
  return {
    centreCode: (v('centre_code') ?? '').toUpperCase(),
    orgCode: v('organisation_code'),
    orgDescription: v('organisation_description'),
    name: (v('centre_name') ?? '').replace(/\s+/g, ' '),
    phone: v('centre_contact_no') ?? v('contactno_lifesg'),
    email: v('centre_email_address') ?? v('emailaddress_lifesg'),
    address: v('centre_address'),
    postcode: v('postal_code'),
    website: v('centre_website') ?? v('website_lifesg'),
    serviceModel: v('service_model'),
  };
}

// The anchor operators, the large private chains, the NGO and grassroots networks,
// and the public-sector kindergartens. The local equivalent of the national-chain
// rule in the childcare vertical's score vocabulary.
const SG_CHAINS = /\b(ntuc\b|first campus|my first skool|\bpcf\b|sparkletots|moe kindergarten|ministry of education|e-?bridge|skool4kidz|little footprints|mindchamps|busy bees|etonhouse|eton house|pat'?s schoolhouse|kinderland|\bmy world\b|\bmetta\b|\bmwspa\b|\bawwa\b|\bsasco\b|\bmodern montessori\b|maple bear|brighton montessori|chiltern house|julia gabriel|nurture ?stars|carpe diem|cherie hearts|learning vision|the little skool-?house|star learners|white lodge|odyssey|shaws|safari house|little paddington|raffles kidz|josiah montessori|sunflower|red schoolhouse|bibinogs|thomson |global eduhub|kids ?campus|ascension kindergarten|st ?james' ?church kindergarten|lighthouse evangelism|\bmasjid\b|\bsingapore islamic\b|\bchurch\b|\btemple\b|community foundation|family service cent)\b/i;

export type Evaluation =
  | { keep: true; adjust: number; reasons: string[] }
  | { keep: false; reason: string };

// A Singapore postal code is six digits.
export function isSgPostcode(raw: string | null | undefined): boolean {
  return /^\d{6}$/.test((raw ?? '').trim());
}

export function evaluateSgEcdaRow(row: SgEcdaRow, centresForOrg: number): Evaluation {
  if (!row.name) return { keep: false, reason: 'no centre name' };
  if (!row.centreCode) return { keep: false, reason: 'no centre code' };
  if (!isSgPostcode(row.postcode)) return { keep: false, reason: 'no valid Singapore postal code' };
  if (!cleanEmail(row.email)) return { keep: false, reason: 'no usable email in the ECDA list' };
  if (SG_CHAINS.test(row.name) || SG_CHAINS.test(row.orgDescription ?? '')) {
    return { keep: false, reason: 'anchor operator, national chain, NGO or public-sector kindergarten' };
  }
  if (centresForOrg > SG_MAX_CENTRES_PER_ORG) {
    return { keep: false, reason: `operator runs ${centresForOrg} centres, so it is a chain with a head office rather than an owner-run centre` };
  }

  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };

  add(3, 'licensed by the Singapore Early Childhood Development Agency as a child care centre');
  if (centresForOrg === 1) add(3, 'the operator runs this one centre only');
  else add(1, `the operator runs ${centresForOrg} centres`);

  const email = cleanEmail(row.email);
  if (email && !isFreeMail(email)) add(5, 'business-domain email address published in the ECDA list');
  else if (email) add(-8, 'contact is a free-mail address (no business domain to verify)');

  if (row.website) add(3, 'publishes its own website in the ECDA list');
  if (formatIntlPhone(row.phone)) add(2, 'publishes a phone number in the ECDA list');

  return { keep: true, adjust, reasons };
}

export function sgEcdaSourceKey(centreCode: string): string {
  return `childcare:sg:${centreCode.toUpperCase()}`;
}

// "https://www.example.com.sg/x" -> "example.com.sg"; null if unusable.
export function sgEcdaDomain(raw: string | null): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    return h.includes('.') ? h : null;
  } catch {
    return null;
  }
}

export function toSgEcdaLead(row: SgEcdaRow, ev: Extract<Evaluation, { keep: true }>): RegistryLead {
  const name = titleCase(row.name);
  // Singapore is a city-state: the city IS Singapore, so the location is written
  // "Singapore, SG" and language.ts resolves it to English deliberately.
  const location = cityCountry('Singapore', 'SG');
  const phone = formatIntlPhone(row.phone);
  const email = cleanEmail(row.email);
  const typeLabel = 'licensed child care centre';
  return {
    sourceKey: sgEcdaSourceKey(row.centreCode),
    name,
    legalName: row.orgDescription && row.orgDescription !== row.name ? row.orgDescription : null,
    city: 'Singapore',
    state: 'SG',
    phone,
    licenseId: row.centreCode,
    registryName: SG_ECDA_REGISTRY,
    typeLabel,
    contactName: null,
    location,
    description: `Listed in the Singapore Early Childhood Development Agency (ECDA) list of licensed child care centres as a ${typeLabel}, based in ${location}.`,
    signalDetail: `ECDA centre ${row.centreCode}${row.serviceModel ? ` (${row.serviceModel})` : ''}, operator ${row.orgDescription ?? row.orgCode ?? '?'}, postal code ${row.postcode ?? '?'}${phone ? `; ECDA phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email,
    domain: sgEcdaDomain(row.website),
    contactSourceUrl: email ? SG_ECDA_DATASET_PAGE : null,
    country: 'SG',
  };
}

// ---- network ---------------------------------------------------------------

export interface SgPage {
  total: number;
  records: Record<string, unknown>[];
}

// data.gov.sg reports a rate limit INSIDE a 200 body, so an error body must be
// raised as an error or the walk would read it as "no more records" and stop.
export class SgRateLimited extends Error {}

export function parseSgPage(body: unknown): SgPage {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.success === false || b.error) {
    const err = (b.error ?? {}) as Record<string, unknown>;
    const message = String(err.message ?? err.__type ?? JSON.stringify(err)).slice(0, 200);
    if (/too_?many_?requests|rate.?limit/i.test(message)) throw new SgRateLimited(message);
    throw new Error(`data.gov.sg datastore error: ${message}`);
  }
  const r = (b.result ?? {}) as Record<string, unknown>;
  const records = Array.isArray(r.records) ? (r.records as Record<string, unknown>[]) : null;
  if (!records) throw new Error('data.gov.sg datastore response has no records array');
  return { total: typeof r.total === 'number' ? r.total : records.length, records };
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': DISCOVERY_UA, Accept: 'application/json' }, signal: controller.signal, redirect: 'follow' });
    // A real 429 as well as the in-body form.
    if (res.status === 429 || res.status === 503) throw new SgRateLimited(`HTTP ${res.status}`);
    if (!res.ok) throw new Error(`data.gov.sg unavailable (HTTP ${res.status})`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export interface SgEcdaOpts {
  isKnown?: (sourceKey: string) => boolean;
  log?: (m: string) => void;
  timeoutMs?: number;
  pageSize?: number;
  // Politeness pause between pages, and the retry back-off for a rate-limited one.
  pauseMs?: number;
  maxRetries?: number;
  // Test seam: pages in order instead of the network.
  pagesOverride?: SgPage[];
}

export const SG_DEFAULT_PAUSE_MS = 1_200;
export const SG_DEFAULT_MAX_RETRIES = 5;

// Fetches every page first and only then evaluates, because the chain test needs to
// know how many centres each operator runs — which is not knowable until the whole
// list has been read. 1,871 small records is perfectly affordable to hold.
export async function fetchAllSgEcdaRecords(opts: SgEcdaOpts = {}): Promise<{ rows: SgEcdaRow[]; total: number; errors: string[] }> {
  const errors: string[] = [];
  if (opts.pagesOverride) {
    const rows = opts.pagesOverride.flatMap((p) => p.records.map(toSgEcdaRow));
    return { rows, total: opts.pagesOverride[0]?.total ?? rows.length, errors };
  }
  const limit = opts.pageSize ?? 500;
  const pause = opts.pauseMs ?? SG_DEFAULT_PAUSE_MS;
  const maxRetries = opts.maxRetries ?? SG_DEFAULT_MAX_RETRIES;
  const rows: SgEcdaRow[] = [];
  let total = 0;
  for (let offset = 0; ; offset += limit) {
    let page: SgPage | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        page = parseSgPage(await fetchJson(sgEcdaPageUrl(limit, offset), opts.timeoutMs ?? 60_000));
        break;
      } catch (e) {
        if (!(e instanceof SgRateLimited) || attempt === maxRetries) throw e;
        const backoff = pause * 2 ** (attempt + 1);
        opts.log?.(`sg ecda: rate limited at offset ${offset}, waiting ${backoff}ms and retrying (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(backoff);
      }
    }
    if (!page) break;
    if (offset === 0) total = page.total;
    if (!page.records.length) break;
    for (const raw of page.records) rows.push(toSgEcdaRow(raw));
    opts.log?.(`sg ecda: ${rows.length}/${total} records`);
    if (rows.length >= total) break;
    await sleep(pause);
  }
  if (total && rows.length < total) errors.push(`sg ecda: read ${rows.length} of ${total} records`);
  return { rows, total, errors };
}

// organisation_code -> how many centres it runs. The structural chain test.
export function countCentresPerOrg(rows: SgEcdaRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    // A row with no operator code is treated as its own operator, which is the
    // conservative reading (one centre, not part of a chain we can prove).
    const k = r.orgCode ?? `centre:${r.centreCode}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export async function findSgEcdaCandidates(max: number, opts: SgEcdaOpts = {}): Promise<RegistryResult> {
  const result = emptyResult();
  try {
    const { rows, errors } = await fetchAllSgEcdaRecords(opts);
    result.errors.push(...errors);
    const counts = countCentresPerOrg(rows);
    const seen = new Set<string>();
    const seenEmails = new Set<string>();
    for (const row of rows) {
      if (result.candidates.length >= max) break;
      result.scanned++;
      const key = sgEcdaSourceKey(row.centreCode);
      if (seen.has(key)) { reject(result, 'duplicate centre code'); continue; }
      if (opts.isKnown?.(key)) { seen.add(key); reject(result, 'already known'); continue; }
      const ev = evaluateSgEcdaRow(row, counts.get(row.orgCode ?? `centre:${row.centreCode}`) ?? 1);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      const lead = toSgEcdaLead(row, ev);
      if (lead.email) {
        if (seenEmails.has(lead.email)) { reject(result, 'shared mailbox with a centre already kept'); continue; }
        seenEmails.add(lead.email);
      }
      seen.add(key);
      result.candidates.push(lead);
    }
    opts.log?.(`sg ecda: scanned ${result.scanned}, candidates ${result.candidates.length}`);
  } catch (e) {
    result.errors.push(`sg ecda: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

export function allSgEcdaLeads(opts: SgEcdaOpts = {}): Promise<RegistryResult> {
  return findSgEcdaCandidates(Number.MAX_SAFE_INTEGER, opts);
}
