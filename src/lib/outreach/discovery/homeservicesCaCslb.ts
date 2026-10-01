import { findHeader, mapRow, makeRowParser } from './delimitedStream';
import { DISCOVERY_UA } from './http';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, type RegistryLead, type RegistryResult } from './registryCommon';

// Home-services discovery from the California Contractors State License Board
// (CSLB) "Master List of California Licensed Contractors", the public data
// portal at https://www.cslb.ca.gov/onlineservices/dataportal/ContractorList
// (free, no login, no robots.txt; verified live 2026-09-30):
//
//   License Master CSV   245,421 rows, 245,171 (99.9%) with a business phone,
//                        0% with an email (Business & Professions Code section
//                        27 forbids publishing contractor email addresses; the
//                        portal says so itself), freshest LastUpdate 2026-09-30.
//                        231,720 are PrimaryStatus CLEAR (active).
//
// So this is a PHONE-FIRST source: every kept lead carries the registry phone
// and no email, and stageEnrich has to resolve a website/email the way the
// Virginia and Delaware sources do. Never invent an email from this file.
//
// How the file is fetched: the portal is an ASP.NET WebForms page, there is no
// static file URL. Two form posts reproduce exactly what the page's own
// "License Master" drop-down and "CSV" link do: (1) the async postback that
// selects the file (it returns fresh __VIEWSTATE / __EVENTVALIDATION), then
// (2) the postback of the CSV link, which answers with
// `Content-Disposition: attachment; filename=MasterLicenseData.csv`. ~78 MB.
//
// Columns used: LicenseNo, BusinessName (the name the contractor operates
// under), BUS-NAME-2 (the legal/other name, mostly corporations), FullBusinessName
// ("LEGAL DBA TRADE" for DBAs; for sole owners the person's name in natural
// order, while BusinessName is "LAST FIRST MIDDLE"), City, State, BusinessPhone,
// BusinessType, ExpirationDate, PrimaryStatus, SecondaryStatus,
// Classifications(s) (pipe separated, e.g. "B| C10").

export const CSLB_PAGE_URL = 'https://www.cslb.ca.gov/onlineservices/dataportal/ContractorList';
export const CSLB_REGISTRY = 'California Contractors State License Board';
const LIST_NOUN = 'contractor license master list';

export const CSLB_COL = {
  licenseNo: 'LicenseNo',
  businessName: 'BusinessName',
  name2: 'BUS-NAME-2',
  fullName: 'FullBusinessName',
  city: 'City',
  state: 'State',
  phone: 'BusinessPhone',
  businessType: 'BusinessType',
  expiration: 'ExpirationDate',
  status: 'PrimaryStatus',
  secondary: 'SecondaryStatus',
  classes: 'Classifications(s)',
  lastUpdate: 'LastUpdate',
} as const;

export interface CslbRow {
  licenseNo: string;
  businessName: string;
  name2: string | null;
  fullName: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  businessType: string | null;
  expiration: string | null;
  status: string;
  secondary: string | null;
  classes: string[];
  lastUpdate: string | null;
}

export function toCslbRow(o: Record<string, string>): CslbRow {
  const v = (k: string) => (o[k] ?? '').trim() || null;
  return {
    licenseNo: (o[CSLB_COL.licenseNo] ?? '').trim(),
    businessName: (o[CSLB_COL.businessName] ?? '').replace(/\s+/g, ' ').trim(),
    name2: v(CSLB_COL.name2),
    fullName: v(CSLB_COL.fullName),
    city: v(CSLB_COL.city),
    state: v(CSLB_COL.state),
    phone: v(CSLB_COL.phone),
    businessType: v(CSLB_COL.businessType),
    expiration: v(CSLB_COL.expiration),
    status: (o[CSLB_COL.status] ?? '').trim().toUpperCase(),
    secondary: v(CSLB_COL.secondary),
    // "B| C10" -> ['B', 'C10']; "C-10" style is normalised to "C10".
    classes: (o[CSLB_COL.classes] ?? '').split('|').map((c) => c.trim().toUpperCase().replace(/^([A-D])-/, '$1')).filter(Boolean),
    lastUpdate: v(CSLB_COL.lastUpdate),
  };
}

// Classification codes (CSLB classification list) that are the phone-driven
// plumbing / HVAC / electrical / roofing service trades, in the order the
// description picks one when a licence holds several. Counts in the 245k file:
// C10 29,233; C36 18,340; C20 12,254; C39 5,793; C38, C4, C42 smaller.
const TRADES: { code: string; label: string }[] = [
  { code: 'C36', label: 'plumbing contractor' },
  { code: 'C20', label: 'HVAC contractor' },
  { code: 'C10', label: 'electrical contractor' },
  { code: 'C39', label: 'roofing contractor' },
  { code: 'C38', label: 'refrigeration contractor' },
  { code: 'C4', label: 'boiler, hot water heating and steam fitting contractor' },
  { code: 'C42', label: 'sanitation system contractor' },
];

// General building licences (B, B-2, A general engineering) are kept only when
// the business NAME reads like one of the trades, and then described generically.
const GENERIC_CODES = new Set(['B', 'B2', 'A']);
const TRADE_NAME_RE = /\b(hvac|heating|air ?condition|\bac\b|cooling|refrigerat|plumb(ing|er)?|rooter|drain|sewer|electric(al)?|roof(ing|er)?|gutter|boiler|furnace)\b/i;
const NAME_TRADES: { re: RegExp; code: string }[] = [
  { re: /\b(plumb(ing|er)?|rooter|drain|sewer)\b/i, code: 'C36' },
  { re: /\b(hvac|heating|air ?condition|\bac\b|cooling|furnace)\b/i, code: 'C20' },
  { re: /\belectric(al)?\b/i, code: 'C10' },
  { re: /\broof(ing|er)?\b/i, code: 'C39' },
];
const GENERIC_LABEL = 'licensed contractor';

// National brands, franchises and the very large California electrical /
// mechanical / solar firms that hold CSLB licences but are not a small service
// business with a front desk of their own.
const BIG_HOMESERVICES = /\b(roto[- ]?rooter|mr\.? rooter|mr\.? electric|one hour (heating|air)|benjamin franklin plumbing|aire serv|ars\/?rescue rooter|service experts|home depot|lowe'?s|sears|comfort systems|emcor|limbach|\bapi group\b|rosendin|cupertino electric|helix electric|sunrun|sunpower|tesla|solarcity|vivint solar|sunnova|bergelectric|southland industries|abm industries|johnson controls|siemens|honeywell|trane|schneider electric|ameresco|bechtel|fluor|kiewit|jacobs|aecom|skanska|turner construction|webcor|swinerton|\bdpr construction\b|mcCarthy building|clark construction|hensel phelps|sundt|granite construction|pacific gas|southern california edison|mccarthy)\b/i;

export type Evaluation = { keep: true; adjust: number; reasons: string[]; typeLabel: string } | { keep: false; reason: string };

// "09/25/2026" -> Date (CSLB writes MM/DD/YYYY).
export function parseCslbDate(raw: string | null | undefined): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((raw ?? '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
  return Number.isNaN(d.getTime()) ? null : d;
}

// The name shown on the lead and whether it is a sole proprietor's own name.
// A sole owner's BusinessName is "DOCKERY RANDALL MARK" (surname first) and its
// FullBusinessName is "RANDALL MARK DOCKERY"; the natural-order form is used so
// individualName.looksLikeIndividual recognises it downstream.
export function cslbDisplayName(r: CslbRow): { name: string; legalName: string | null; individual: boolean } {
  const soleOwner = (r.businessType ?? '').toLowerCase() === 'sole owner';
  if (soleOwner && !r.name2) {
    const full = r.fullName && !/\bdba\b/i.test(r.fullName) ? r.fullName : null;
    if (full) return { name: titleCase(full), legalName: null, individual: true };
    return { name: titleCase(r.businessName), legalName: null, individual: false };
  }
  const legal = r.name2 && r.name2 !== r.businessName ? titleCase(r.name2) : null;
  return { name: titleCase(r.businessName), legalName: legal, individual: false };
}

export function evaluateCslbRow(r: CslbRow, now = new Date()): Evaluation {
  if (!r.licenseNo) return { keep: false, reason: 'no licence number' };
  if (!r.businessName) return { keep: false, reason: 'no business name' };
  if (r.status !== 'CLEAR') return { keep: false, reason: 'licence not active (suspended or otherwise not clear)' };
  // A workers' comp suspension pending is the file's own signal the business may be winding down.
  if (/wc susp/i.test(r.secondary ?? '')) return { keep: false, reason: "workers' compensation suspension pending" };
  const exp = parseCslbDate(r.expiration);
  if (!exp || exp.getTime() < now.getTime()) return { keep: false, reason: 'licence expired' };
  const allNames = `${r.businessName} ${r.name2 ?? ''} ${r.fullName ?? ''}`;
  if (BIG_HOMESERVICES.test(allNames)) return { keep: false, reason: 'national brand, franchise or large firm name' };
  const phone = formatUsPhone(r.phone);
  if (!phone) return { keep: false, reason: 'no usable phone (the file never carries an email)' };

  // A licence often holds several trade classes; when the business name names
  // one of them ("Desert Elite Electric"), describe that one.
  const held = TRADES.filter((t) => r.classes.includes(t.code));
  const nameTrade = NAME_TRADES.find((n) => n.re.test(allNames) && held.some((t) => t.code === n.code));
  const trade = held.find((t) => t.code === nameTrade?.code) ?? held[0];
  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };
  let typeLabel: string;
  if (trade) {
    typeLabel = `licensed ${trade.label}`;
    add(3, `licensed for the ${trade.code} classification`);
  } else if (r.classes.some((c) => GENERIC_CODES.has(c)) && TRADE_NAME_RE.test(allNames)) {
    typeLabel = GENERIC_LABEL;
  } else {
    return { keep: false, reason: 'classification is not an HVAC/plumbing/electrical/roofing trade' };
  }

  add(-6, 'no email in the licence file (California law bars publishing contractor email)');
  add(3, 'registry phone published for phone-first follow-up');
  const { individual } = cslbDisplayName(r);
  if (individual) add(-4, 'sole proprietor licensed in their own name (phone may be personal)');
  if (r.state && r.state.toUpperCase() !== 'CA') add(-5, 'licensed in California but based out of state');
  return { keep: true, adjust, reasons, typeLabel };
}

export function cslbSourceKey(r: CslbRow): string {
  return `homeservices:ca:${r.licenseNo}`;
}

export function toCslbLead(r: CslbRow, ev: { adjust: number; reasons: string[]; typeLabel: string }): RegistryLead {
  const { name, legalName } = cslbDisplayName(r);
  const state = (r.state ?? 'CA').toUpperCase();
  const location = cityState(r.city, state);
  const phone = formatUsPhone(r.phone);
  return {
    sourceKey: cslbSourceKey(r),
    name,
    legalName,
    city: r.city ? titleCase(r.city) : null,
    state,
    phone,
    licenseId: r.licenseNo,
    registryName: CSLB_REGISTRY,
    typeLabel: ev.typeLabel,
    contactName: null,
    location,
    description: describeRegistryLead({ typeLabel: ev.typeLabel, registryName: CSLB_REGISTRY, location, legalName, name, listNoun: LIST_NOUN }),
    signalDetail: `CSLB contractor licence ${r.licenseNo} (${r.classes.join(' ')})${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: null,
    contactSourceUrl: null,
  };
}

// ---- network ---------------------------------------------------------------

// ASP.NET WebForms hidden-field plumbing. In a normal page the value sits in
// `id="__X" value="..."`; in an async (UpdatePanel) response it is a
// length-prefixed `|hiddenField|__X|value|` record, and the value contains no '|'.
export function aspField(body: string, name: string): string {
  const html = new RegExp(`id="${name}"[^>]*value="([^"]*)"`).exec(body);
  if (html) return html[1].replace(/&#43;/g, '+').replace(/&amp;/g, '&');
  const delta = new RegExp(`\\|hiddenField\\|${name}\\|([^|]*)\\|`).exec(body);
  if (delta) return delta[1];
  throw new Error(`CSLB portal: hidden field ${name} not found; page layout may have changed`);
}

function cookieHeader(res: Response, prior: string): string {
  const jar = new Map<string, string>();
  for (const part of prior.split('; ').filter(Boolean)) { const i = part.indexOf('='); jar.set(part.slice(0, i), part.slice(i + 1)); }
  const set = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of set) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

// Performs the two form posts and returns the CSV response (body not consumed).
export async function fetchCslbMasterCsv(signal?: AbortSignal): Promise<Response> {
  const baseHeaders = { 'User-Agent': DISCOVERY_UA, Accept: '*/*' } as Record<string, string>;
  const page = await fetch(CSLB_PAGE_URL, { headers: baseHeaders, signal, redirect: 'follow' });
  if (!page.ok) throw new Error(`CSLB portal unavailable (HTTP ${page.status})`);
  let cookies = cookieHeader(page, '');
  const html = await page.text();
  const post = (body: URLSearchParams, extra: Record<string, string> = {}) =>
    fetch(CSLB_PAGE_URL, { method: 'POST', headers: { ...baseHeaders, 'Content-Type': 'application/x-www-form-urlencoded', ...(cookies ? { Cookie: cookies } : {}), ...extra }, body, signal, redirect: 'follow' });

  const select = await post(
    new URLSearchParams({
      __EVENTTARGET: 'ctl00$MainContent$ddlStatus', __EVENTARGUMENT: '', __LASTFOCUS: '',
      __VIEWSTATE: aspField(html, '__VIEWSTATE'), __VIEWSTATEGENERATOR: aspField(html, '__VIEWSTATEGENERATOR'), __EVENTVALIDATION: aspField(html, '__EVENTVALIDATION'),
      'ctl00$MainContent$ddlStatus': 'M', 'ctl00$MainContent$smPanel': 'ctl00$MainContent$uplinks|ctl00$MainContent$ddlStatus', __ASYNCPOST: 'true',
    }),
    { 'X-MicrosoftAjax': 'Delta=true' },
  );
  if (!select.ok) throw new Error(`CSLB portal file selection failed (HTTP ${select.status})`);
  cookies = cookieHeader(select, cookies);
  const delta = await select.text();

  const csv = await post(new URLSearchParams({
    __EVENTTARGET: 'ctl00$MainContent$lbMasterCSV', __EVENTARGUMENT: '', __LASTFOCUS: '',
    __VIEWSTATE: aspField(delta, '__VIEWSTATE'), __VIEWSTATEGENERATOR: aspField(delta, '__VIEWSTATEGENERATOR'), __EVENTVALIDATION: aspField(delta, '__EVENTVALIDATION'),
    'ctl00$MainContent$ddlStatus': 'M',
  }));
  const type = csv.headers.get('content-type') ?? '';
  if (!csv.ok || !csv.body || !/csv|octet|excel/i.test(type)) throw new Error(`CSLB master CSV download failed (HTTP ${csv.status}, ${type || 'no content-type'})`);
  return csv;
}

const REQUIRED = [CSLB_COL.licenseNo, CSLB_COL.businessName, CSLB_COL.phone, CSLB_COL.classes, CSLB_COL.status];

// Streams the master list and keeps rows that pass evaluateCslbRow. `response`
// is injectable for tests and for a local copy of the file.
export async function streamCslbLeads(
  opts: { now?: Date; maxRows?: number; isKnown?: (sourceKey: string) => boolean; response?: Response; timeoutMs?: number; log?: (m: string) => void } = {},
): Promise<RegistryResult & { freshest: string | null }> {
  const now = opts.now ?? new Date();
  const result: RegistryResult & { freshest: string | null } = { ...emptyResult(), freshest: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 300_000);
  try {
    const res = opts.response ?? (await fetchCslbMasterCsv(controller.signal));
    const decoder = new TextDecoder('utf-8');
    const parser = makeRowParser('comma');
    let header: string[] | null = null;
    let freshestTs = 0;
    const take = (raw: string[]) => {
      if (!header) { if (raw.length > 1) header = findHeader(raw, REQUIRED); return; }
      const o = mapRow(header, raw);
      if (Object.values(o).every((x) => x === '')) return;
      result.scanned++;
      const r = toCslbRow(o);
      const lu = parseCslbDate(r.lastUpdate)?.getTime() ?? 0;
      if (lu > freshestTs) { freshestTs = lu; result.freshest = new Date(lu).toISOString().slice(0, 10); }
      if (opts.maxRows && result.candidates.length >= opts.maxRows) return;
      const ev = evaluateCslbRow(r, now);
      if (!ev.keep) { reject(result, ev.reason); return; }
      const lead = toCslbLead(r, ev);
      if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); return; }
      result.candidates.push(lead);
    };
    const reader = res.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) for (const raw of parser.feed(decoder.decode(value, { stream: true }))) take(raw);
    }
    const last = parser.end();
    if (last) take(last);
    if (!header) throw new Error(`CSLB master CSV: header with ${REQUIRED.join(', ')} not found; file layout may have changed`);
    if (result.scanned < 1000) throw new Error(`CSLB master CSV: only ${result.scanned} rows; file layout may have changed`);
    opts.log?.(`streamed ${result.scanned} rows from the CSLB master list`);
  } catch (e) {
    result.errors.push(`homeservices ca cslb: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
  return result;
}

const DAY_MS = 86_400_000;

// Day-rotating window of `max` leads for the daily run, same shape as the
// Arkansas and Virginia sources.
export async function findCslbCandidates(
  max: number,
  opts: { now?: Date; startOverride?: number; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();
  const all = await streamCslbLeads({ now, isKnown: opts.isKnown, log: opts.log });
  result.scanned = all.scanned;
  result.rejected = all.rejected;
  result.errors.push(...all.errors);
  if (!all.candidates.length) return result;
  const day = Math.floor(now.getTime() / DAY_MS);
  const start = opts.startOverride ?? (day * max) % all.candidates.length;
  for (let i = 0; i < all.candidates.length && result.candidates.length < max; i++) {
    result.candidates.push(all.candidates[(start + i) % all.candidates.length]);
  }
  return result;
}

// Whole-population pass for the one-off bulk import.
export async function allCslbLeads(opts: { now?: Date; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {}): Promise<RegistryResult> {
  return streamCslbLeads(opts);
}
