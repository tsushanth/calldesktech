import { cleanEmail, isFreeMail } from './freightFmcsa';
import { DISCOVERY_UA } from './http';
import {
  cityCountry, emptyResult, formatIntlPhone, reject, titleCase, type RegistryLead, type RegistryResult,
} from './registryCommon';

// All-verticals discovery from the NORWEGIAN Enhetsregisteret (Central
// Coordinating Register for Legal Entities), run by Brønnøysundregistrene. JSON
// API, NLOD licence, no key (verified 2026-09-24).
//
// EVERY lead from here is stored ON HOLD (region_blocked + signals.intlHold); see
// registryCommon.INTL_HOLD_REASON.
//
// This is the only source that covers several verticals from one register, because
// it is keyed on the NACE ("næringskode") industry code rather than on a trade
// licence. Verified totals per code, 2026-09-24:
//
//   86.230 Tannlegetjenester (dentists)            6,021  -> dental
//   43.210 Elektrisk installasjonsarbeid           5,655  -> homeservices
//   43.221 Rørleggerarbeid (plumbing/heating)      5,134  -> homeservices
//   43.222 Ventilasjons- og VVS-arbeid             1,176  -> homeservices
//   43.910 Takarbeid (roofing)                     1,204  -> homeservices
//   43.990 Annen spesialisert bygge-/anleggsvirks. 3,446  -> homeservices
//   49.410 Godstransport på vei (road freight)    11,640  -> freight
//   49.420 Flyttetransport (removals)                664  -> towing
//   66.220 Forsikringsagenter/-meglere               274  -> insurance
//   88.101 Hjemmehjelp / 88.102 Eldresenter     259 + 51  -> homecare
//   87.101 Somatiske spesialsykehjem                  55  -> homecare
//
// Note 43.220 does NOT exist in the Norwegian NACE variant (it returns 0 rows);
// plumbing is 43.221 and ventilation/HVAC is 43.222.
//
// SECOND BATCH, verified live 2026-09-24. Norway has moved to SN2025, so a code
// that looks right can silently return zero rows — the old 62.010/62.020/70.220
// all return 0 and their SN2025 replacements 62.100/62.200/70.200 are what carry
// the companies. "0 rows" and "code retired" are indistinguishable from the API,
// so checkBrregCodes() below probes every code a run is about to use and a code
// that answers 0 becomes a LOUD error instead of an empty, silent import.
//
//   86.950 Fysioterapitjeneste (physiotherapy)      6,991  -> physio
//   49.320 Drosjebiltransport (taxi)                  686  -> taxi
//   69.201 Regnskap og bokføring (accountants)        792  -> accounting
//   75.000 Veterinærtjenester (veterinary)          2,068  -> vets
//   68.310 Eiendomsmegling (real estate agents)       796  -> realestate
//
// AGENCY / PARTNER audience (product `calldesk` — the agency-partner pitch, not a
// vertical): the Norwegian equivalents of the AI/voice agencies the Retell
// directory supplies domestically. These are far bigger codes, and several exceed
// the API's 10,000-result window even after the legal-form slice, which is why the
// walk now splits an over-cap slice by REGISTRATION DATE (see BRREG_DATE_SPLITS
// and walkSlice). Employee-count slicing cannot be used for this: Brreg refuses
// any query between one and four employees on privacy grounds ("På grunn av krav
// til personvern kan du ikke gjøre søk mellom en og fire ansatte").
//
//   62.100 Programmeringstjenester (software dev)   17,523  (AS 10,213)
//   62.200 IT-konsulentvirksomhet                   16,149  (AS  7,952)
//   73.110 Reklamebyråer (advertising agencies)     11,131  (AS  3,154)
//   70.200 Bedriftsrådgivning (mgmt consultancy)    31,905  (AS 17,384)
//   82.200 Telefonbasert markedsføring (call centres)  799  (AS    259)
//
// Paging: `page`/`size` is capped at 10,000 results per query (page 10 of size
// 1,000 answers HTTP 400). Road freight is over that on its own, so every query
// is sliced by `organisasjonsform` as well as by NACE code, which keeps each
// slice well under the cap AND doubles as the AS-versus-ENK distinction the
// scoring needs. (Verified: 49.410 is 5,028 AS and 5,669 ENK.)

export const BRREG_API_URL = 'https://data.brreg.no/enhetsregisteret/api/enheter';
export const BRREG_REGISTRY = 'Norwegian Central Coordinating Register for Legal Entities (Enhetsregisteret)';
export const BRREG_SEARCH_URL = 'https://virksomhet.brreg.no/';
const LIST_NOUN = 'register';

// Legal forms queried, in preference order. ENK is the sole proprietorship and is
// queried last and scored down; KBO (bankruptcy estate), KTRF and ANNA are not
// operating businesses and are not queried at all.
export const BRREG_ORG_FORMS = ['AS', 'ASA', 'NUF', 'DA', 'ANS', 'ENK'] as const;
export type BrregOrgForm = (typeof BRREG_ORG_FORMS)[number];

export interface BrregNaceClass {
  code: string;
  label: string; // English trade words used in the lead description
  productId: string;
}

export const BRREG_NACE: BrregNaceClass[] = [
  { code: '86.230', label: 'dental practice', productId: 'dental' },
  { code: '43.210', label: 'electrical installation contractor', productId: 'homeservices' },
  { code: '43.221', label: 'plumbing and heating contractor', productId: 'homeservices' },
  { code: '43.222', label: 'ventilation and HVAC contractor', productId: 'homeservices' },
  { code: '43.910', label: 'roofing contractor', productId: 'homeservices' },
  { code: '43.990', label: 'specialised construction contractor', productId: 'homeservices' },
  { code: '49.410', label: 'road freight haulier', productId: 'freight' },
  { code: '49.420', label: 'removals and vehicle transport operator', productId: 'towing' },
  { code: '66.220', label: 'insurance agency or brokerage', productId: 'insurance' },
  { code: '88.101', label: 'home help and home care provider', productId: 'homecare' },
  { code: '88.102', label: 'day-care centre for the elderly and disabled', productId: 'homecare' },
  { code: '87.101', label: 'nursing and residential care provider', productId: 'homecare' },

  // ---- second batch: the verticals added in the eight-vertical expansion -----
  { code: '86.950', label: 'physiotherapy practice', productId: 'physio' },
  { code: '49.320', label: 'taxi operator', productId: 'taxi' },
  { code: '69.201', label: 'accounting and bookkeeping firm', productId: 'accounting' },
  { code: '75.000', label: 'veterinary practice', productId: 'vets' },
  { code: '68.310', label: 'real estate agency', productId: 'realestate' },

  // ---- the agency / partner audience (product `calldesk`) -------------------
  // Not a vertical: these are the agencies and consultancies the agency-partner
  // pitch is for, ingested as directory leads for the base product exactly as the
  // Retell directory's agencies are, and held like every other non-US lead.
  { code: '62.100', label: 'software development agency', productId: 'calldesk' },
  { code: '62.200', label: 'IT consultancy', productId: 'calldesk' },
  { code: '73.110', label: 'advertising agency', productId: 'calldesk' },
  { code: '70.200', label: 'business and management consultancy', productId: 'calldesk' },
  { code: '82.200', label: 'call centre operator', productId: 'calldesk' },
];

// The codes Norway RETIRED in the move to SN2025. Kept as a named list so a future
// reader who finds one of them in an old runbook sees immediately that it is dead
// and what replaced it, rather than re-adding it and importing nothing.
export const BRREG_RETIRED_CODES: Record<string, string> = {
  '62.010': '62.100 (Programmeringstjenester)',
  '62.020': '62.200 (IT-konsulentvirksomhet)',
  '70.220': '70.200 (Bedriftsrådgivning)',
  '43.220': '43.221 (plumbing) / 43.222 (ventilation and HVAC)',
};

export function brregClassesFor(productId: string): BrregNaceClass[] {
  return BRREG_NACE.filter((c) => c.productId === productId);
}

export function brregSupportsVertical(productId: string): boolean {
  return brregClassesFor(productId).length > 0;
}

export interface BrregRow {
  orgnr: string;
  name: string;
  orgForm: string | null;
  naceCode: string | null;
  naceLabel: string | null;
  employees: number | null;
  address: string | null;
  postcode: string | null;
  city: string | null;
  municipality: string | null;
  email: string | null;
  website: string | null;
  phone: string | null;
  bankrupt: boolean;
  liquidating: boolean;
  registeredAt: string | null;
}

export function toBrregRow(o: Record<string, unknown>): BrregRow {
  const s = (x: unknown) => {
    const v = typeof x === 'string' ? x.trim() : x == null ? '' : String(x).trim();
    return v || null;
  };
  const addr = (o.forretningsadresse ?? o.postadresse ?? {}) as Record<string, unknown>;
  const nace = (o.naeringskode1 ?? {}) as Record<string, unknown>;
  const form = (o.organisasjonsform ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(addr.adresse) ? (addr.adresse as unknown[]).map((l) => s(l)).filter(Boolean) : [s(addr.adresse)].filter(Boolean);
  const employees = typeof o.antallAnsatte === 'number' ? o.antallAnsatte : null;
  return {
    orgnr: (s(o.organisasjonsnummer) ?? '').replace(/\D/g, ''),
    name: (s(o.navn) ?? '').replace(/\s+/g, ' '),
    orgForm: s(form.kode),
    naceCode: s(nace.kode),
    naceLabel: s(nace.beskrivelse),
    employees,
    address: lines.length ? lines.join(', ') : null,
    postcode: s(addr.postnummer),
    city: s(addr.poststed),
    municipality: s(addr.kommune),
    email: s(o.epostadresse),
    website: s(o.hjemmeside),
    // `telefon` is the switchboard; `mobil` is the fallback.
    phone: s(o.telefon) ?? s(o.mobil),
    bankrupt: o.konkurs === true,
    liquidating: o.underAvvikling === true || o.underTvangsavviklingEllerTvangsopplosning === true,
    registeredAt: s(o.registreringsdatoEnhetsregisteret),
  };
}

// Municipal and county providers, the hospital trusts and the national chains.
const BIG_NO = /\b(kommune|fylkeskommune|helse ?(sør|vest|midt|nord)|helseforetak|\bhf\b|sykehus|universitetssykehus|statens|nav\b|forsvaret|posten\b|bring\b|postnord\b|schenker|dhl\b|dsv\b|kuehne|bring cargo|nor ?engros|coop\b|norgesgruppen|rema ?1000|kiwi\b|meny\b|bunnpris|elkjøp|power\b|maxbo|byggmakker|obs bygg|montér|optimera|caverion|bravida|assemblin|gk\b|veidekke|skanska|af gruppen|peab\b|ncc\b|implenia|bertelsen ?& ?garpestad|if skadeforsikring|gjensidige|tryg\b|fremtind|storebrand|sparebank|dnb\b|nordea|eika\b|frende|codan|colosseum ?tannlege|oris dental|smil tannlege|tannhelse ?(sekretariat|tjenesten)|norlandia|stendi|attendo|aleris|unicare|prima omsorg)\b/i;

// The large Nordic IT houses, consultancies, advertising networks and outsourcers
// that sit in the agency codes (62.100/62.200/73.110/70.200/82.200). Same purpose
// as BIG_NO, kept separate because it only applies to the agency audience and must
// not start filtering dentists called "Accenture" out of a vertical.
const BIG_NO_AGENCY = /\b(accenture|capgemini|sopra ?steria|tietoevry|\btieto\b|evry\b|cgi\b|atea\b|itera\b|bouvet|knowit\b|webstep|sysco\b|visma\b|tripletex|bekk\b|netcompany|nordcloud|crayon\b|infotjenester|deloitte|\bey\b|ernst (and|&) young|\bkpmg\b|\bpwc\b|pricewaterhouse|mckinsey|boston consulting|bain (and|&) company|\bbdo\b|grant thornton|\brsm\b|ramb[øo]ll|multiconsult|norconsult|cowi\b|afry\b|sweco\b|wsp\b|\bdnv\b|sintef|menon\b|oslo economics|dentsu|publicis|omnicom|havas\b|wpp\b|ogilvy|mccann|\btry\b as|kitchen leo burnett|geelmuyden|nucleus|anti\b|schjærven|los ?& ?co|mindshare|carat\b|initiative|essence|ihm\b|teleperformance|transcom|webhelp|sitel\b|foundever|concentrix|\bsykes\b|telenor|telia\b|ice ?communication|nhst|schibsted|amedia|egmont|\bibm\b|microsoft|google|amazon|oracle|\bsap\b|salesforce|infosys|wipro|tata consultancy|\btcs\b|cognizant|hcl technologies|\bepam\b|globant|thoughtworks|nagarro|\bexb\b)\b/i;
export const BRREG_AGENCY_PRODUCT = 'calldesk';

export type Evaluation =
  | { keep: true; adjust: number; reasons: string[] }
  | { keep: false; reason: string };

export function evaluateBrregRow(row: BrregRow, nace: BrregNaceClass): Evaluation {
  if (!row.name) return { keep: false, reason: 'no company name' };
  // The Norwegian organisation number is 9 digits.
  if (row.orgnr.length !== 9) return { keep: false, reason: 'no valid organisation number' };
  if (row.bankrupt) return { keep: false, reason: 'bankrupt (konkurs)' };
  if (row.liquidating) return { keep: false, reason: 'being wound up (under avvikling)' };
  if (!row.city) return { keep: false, reason: 'no business address' };
  if (row.naceCode && row.naceCode !== nace.code) return { keep: false, reason: 'industry code does not match the vertical' };
  if (BIG_NO.test(row.name)) return { keep: false, reason: 'municipality, health trust or national chain' };
  if (nace.productId === BRREG_AGENCY_PRODUCT && BIG_NO_AGENCY.test(row.name)) {
    return { keep: false, reason: 'large IT house, consultancy, advertising network or outsourcer, not a small agency' };
  }

  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };

  add(3, `registered under Norwegian industry code ${nace.code} (${row.naceLabel ?? nace.label})`);

  // AS is the ordinary limited company and is what we want. ENK is a sole
  // proprietorship: the "business" address and email can be the owner's personal
  // ones, which is a higher privacy risk and a much smaller business, so it is
  // scored down hard and flagged in signals.reasons for the reviewer.
  if (row.orgForm === 'AS' || row.orgForm === 'ASA') add(4, 'registered as an aksjeselskap (limited company)');
  else if (row.orgForm === 'ENK') add(-12, 'SOLE PROPRIETORSHIP (enkeltpersonforetak): its registered contact details may be personal data, and it is a one-person business');
  else if (row.orgForm === 'NUF') add(-4, 'Norwegian branch of a foreign company (NUF)');
  else if (row.orgForm) add(-2, `registered as a ${row.orgForm}, not an aksjeselskap`);

  const email = cleanEmail(row.email);
  if (email && !isFreeMail(email)) add(5, 'business-domain email address published in the register');
  else if (email) add(-10, 'register email is a free-mail address, so it is not used as the contact');

  if (row.website) add(3, 'publishes its own website in the register');
  if (formatIntlPhone(row.phone)) add(2, 'publishes a phone number in the register');

  const n = row.employees;
  if (n != null && n >= 250) add(-15, `${n} employees (too large)`);
  else if (n != null && n >= 3) add(3, `${n} employees (an established small business)`);
  else if (n === 0) add(-6, 'no registered employees');

  return { keep: true, adjust, reasons };
}

export function brregSourceKey(productId: string, orgnr: string): string {
  return `${productId}:no:${orgnr.replace(/\D/g, '')}`;
}

// "https://www.example.no/x" / "www.example.no" -> "example.no"; null if unusable.
export function brregDomain(raw: string | null): string | null {
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

export function toBrregLead(row: BrregRow, nace: BrregNaceClass, ev: Extract<Evaluation, { keep: true }>): RegistryLead {
  const name = titleCase(row.name);
  const location = cityCountry(row.city, 'NO');
  const phone = formatIntlPhone(row.phone);
  const email = cleanEmail(row.email);
  const usableEmail = email && !isFreeMail(email) ? email : null;
  let description = `Listed in the Norwegian Enhetsregisteret ${LIST_NOUN} as a ${nace.label}`;
  if (location) description += `, based in ${location}`;
  return {
    sourceKey: brregSourceKey(nace.productId, row.orgnr),
    name,
    legalName: row.name !== name ? row.name : null,
    city: row.city ? titleCase(row.city) : null,
    state: 'NO',
    phone,
    licenseId: row.orgnr,
    registryName: BRREG_REGISTRY,
    typeLabel: nace.label,
    contactName: null,
    location,
    description: `${description}.`,
    signalDetail: `Enhetsregisteret ${row.orgnr} (${row.orgForm ?? '?'}), industry ${row.naceCode ?? nace.code} ${row.naceLabel ?? ''}`.trim() + (phone ? `; register phone ${phone}` : ''),
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: usableEmail,
    domain: usableEmail ? null : brregDomain(row.website),
    contactSourceUrl: usableEmail ? `${BRREG_SEARCH_URL}enhet/${row.orgnr}` : null,
    country: 'NO',
  };
}

// ---- network ---------------------------------------------------------------

export interface BrregPage {
  total: number;
  totalPages: number;
  entities: Record<string, unknown>[];
}

export function parseBrregPage(body: unknown): BrregPage {
  const b = (body ?? {}) as Record<string, unknown>;
  const page = (b.page ?? {}) as Record<string, unknown>;
  const embedded = (b._embedded ?? {}) as Record<string, unknown>;
  const entities = Array.isArray(embedded.enheter) ? (embedded.enheter as Record<string, unknown>[]) : [];
  return {
    total: typeof page.totalElements === 'number' ? page.totalElements : entities.length,
    totalPages: typeof page.totalPages === 'number' ? page.totalPages : entities.length ? 1 : 0,
    entities,
  };
}

// The API's page/size window is capped at 10,000 results, so a query that would
// exceed it cannot be walked. Every query here is narrowed by legal form as well
// as by industry code, which keeps each one comfortably inside the cap.
export const BRREG_PAGE_CAP = 10_000;

// A registration-date window used to split a slice that is over the result cap.
// Inclusive on both ends; `null` on either side means "unbounded", which is how a
// slice that fits the cap is queried (no date parameters at all).
export interface BrregDateRange {
  from: string | null; // ISO yyyy-mm-dd
  to: string | null;
}

export const BRREG_FULL_RANGE: BrregDateRange = { from: null, to: null };

export function brregQueryUrl(naceCode: string, orgForm: string, page: number, size = 1000, range: BrregDateRange = BRREG_FULL_RANGE): string {
  const p = new URLSearchParams({ naeringskode: naceCode, size: String(size), page: String(page) });
  // An empty legal form means "every form" (the one-row SN2025 probe); sending
  // `organisasjonsform=` would be a 400.
  if (orgForm) p.set('organisasjonsform', orgForm);
  // Registration date is the one filter Brreg imposes no privacy floor on, so it
  // is what an over-cap slice is split by.
  if (range.from) p.set('fraRegistreringsdatoEnhetsregisteret', range.from);
  if (range.to) p.set('tilRegistreringsdatoEnhetsregisteret', range.to);
  return `${BRREG_API_URL}?${p.toString()}`;
}

// Enhetsregisteret starts in the 1990s but carries registration dates back to the
// 19th century for old foundations, and a range must cover future-dated rows too.
const BRREG_EPOCH = '1800-01-01';
const BRREG_OMEGA = '2100-12-31';

// Halves a date range by calendar day. Returns null when the range is already a
// single day and so cannot be split any further — the signal to stop recursing and
// accept that this slice is unreachable.
export function splitDateRange(range: BrregDateRange): [BrregDateRange, BrregDateRange] | null {
  const from = range.from ?? BRREG_EPOCH;
  const to = range.to ?? BRREG_OMEGA;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  const DAY = 86_400_000;
  const mid = a + Math.floor((b - a) / (2 * DAY)) * DAY;
  if (mid <= a || mid >= b) return null;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const nextDay = iso(mid + DAY);
  return [{ from, to: iso(mid) }, { from: nextDay, to }];
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': DISCOVERY_UA, Accept: 'application/json' }, signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`Brreg API unavailable (HTTP ${res.status})`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export interface BrregOpts {
  now?: Date;
  isKnown?: (sourceKey: string) => boolean;
  log?: (m: string) => void;
  pageSize?: number;
  timeoutMs?: number;
  orgForms?: readonly string[];
  // Overall budget for the whole walk, not just one request. A bulk import of a
  // multi-code vertical makes dozens of requests, and a live full pass was seen to
  // stall for many minutes when the API started throttling: a per-request timeout
  // does not bound that, because each slow-but-succeeding request resets it. When
  // the budget runs out the walk stops and says so, returning what it has, which is
  // the same shape as any other partial result here.
  deadlineMs?: number;
  // Test seam: (naceCode, orgForm, page) -> page, instead of the network. `range`
  // is the registration-date window an over-cap slice has been split into; the
  // existing three-argument fakes ignore it and are unaffected.
  fetchPage?: (naceCode: string, orgForm: string, page: number, range: BrregDateRange) => Promise<BrregPage>;
  // How many times an over-cap slice may be halved by registration date before it
  // is given up on. 2^8 = 256 windows, far more than the biggest code needs.
  maxDateSplits?: number;
  // Set false to skip the retired-code probe (used by the fixture tests, which
  // have no network).
  checkCodes?: boolean;
}

export const BRREG_DEFAULT_DEADLINE_MS = 20 * 60_000;
export const BRREG_DEFAULT_MAX_DATE_SPLITS = 8;

// " registered 2010-01-01..2017-12-31" for a log line / error; "" for the whole range.
function label(range: BrregDateRange): string {
  if (!range.from && !range.to) return '';
  return ` registered ${range.from ?? '…'}..${range.to ?? '…'}`;
}

// THE SN2025 GUARD. Norway renumbered its industry codes, and the API answers a
// retired code with a perfectly valid, empty result — so a stale code imports
// nothing and says nothing. This probes each code with a one-row query before the
// walk and returns the ones that came back empty, which findBrregCandidates turns
// into a loud error. Every message names the replacement when we know it.
export async function checkBrregCodes(
  codes: string[],
  probe: (code: string) => Promise<number>,
): Promise<string[]> {
  const dead: string[] = [];
  for (const code of codes) {
    let total: number;
    try {
      total = await probe(code);
    } catch {
      // A network failure is not evidence that the code is dead; the walk itself
      // will surface it.
      continue;
    }
    if (total === 0) {
      const replacement = BRREG_RETIRED_CODES[code];
      dead.push(
        `NORWEGIAN INDUSTRY CODE ${code} RETURNS ZERO ROWS and would have imported nothing silently`
        + (replacement ? `: it was retired in the move to SN2025 and replaced by ${replacement}` : '; check it against the current SN2025 code list before trusting this run'),
      );
    }
  }
  return dead;
}

export async function findBrregCandidates(productId: string, max: number, opts: BrregOpts = {}): Promise<RegistryResult> {
  const result = emptyResult();
  const classes = brregClassesFor(productId);
  if (!classes.length) {
    result.errors.push(`no brreg: no Norwegian industry code for ${productId}`);
    return result;
  }
  const size = opts.pageSize ?? 1000;
  const seen = new Set<string>();
  const get = opts.fetchPage
    ?? (async (code: string, form: string, page: number, range: BrregDateRange) => parseBrregPage(await fetchJson(brregQueryUrl(code, form, page, size, range), opts.timeoutMs ?? 60_000)));
  const deadline = Date.now() + (opts.deadlineMs ?? BRREG_DEFAULT_DEADLINE_MS);
  let outOfTime = false;
  const expired = () => {
    if (Date.now() < deadline) return false;
    if (!outOfTime) {
      outOfTime = true;
      result.errors.push(`no brreg ${productId}: ran out of time after ${result.scanned} rows; returning the ${result.candidates.length} candidates found so far (re-run to continue)`);
    }
    return true;
  };

  // The SN2025 guard runs first, so a run against a retired code is loud rather
  // than silently empty. It is one extra one-row request per code.
  if (opts.checkCodes !== false && !opts.fetchPage) {
    const dead = await checkBrregCodes(classes.map((c) => c.code), async (code) => {
      const p = parseBrregPage(await fetchJson(brregQueryUrl(code, '', 0, 1), opts.timeoutMs ?? 60_000));
      return p.total;
    });
    for (const m of dead) {
      result.errors.push(`no brreg ${productId}: ${m}`);
      opts.log?.(`!! ${m}`);
    }
  }

  // Walks one (industry code, legal form, registration-date window) slice, pulling
  // pages until the window is exhausted. When the window holds more rows than the
  // API's result cap it cannot be paged to the end, so it is halved by registration
  // date and each half walked instead — recursively, until every piece fits.
  const maxSplits = opts.maxDateSplits ?? BRREG_DEFAULT_MAX_DATE_SPLITS;
  const walkSlice = async (nace: BrregNaceClass, form: string, range: BrregDateRange, depth: number): Promise<void> => {
    const maxPages = Math.ceil(BRREG_PAGE_CAP / size);
    for (let page = 0; page < maxPages; page++) {
      if (result.candidates.length >= max || expired()) return;
      const p = await get(nace.code, form, page, range);
      if (page === 0 && p.total > BRREG_PAGE_CAP) {
        const halves = depth < maxSplits ? splitDateRange(range) : null;
        if (halves) {
          opts.log?.(`no brreg ${nace.code}/${form}${label(range)}: ${p.total} rows exceeds the ${BRREG_PAGE_CAP}-result window, splitting by registration date`);
          for (const half of halves) {
            if (result.candidates.length >= max || expired()) return;
            await walkSlice(nace, form, half, depth + 1);
          }
          return;
        }
        result.errors.push(`no brreg ${nace.code}/${form}${label(range)}: ${p.total} results exceeds the API's ${BRREG_PAGE_CAP}-result window and the registration-date window cannot be split any further; the remainder is unreachable`);
      }
      if (!p.entities.length) return;
      for (const raw of p.entities) {
        result.scanned++;
        const row = toBrregRow(raw);
        const key = brregSourceKey(nace.productId, row.orgnr);
        if (seen.has(key)) { reject(result, 'duplicate organisation number'); continue; }
        if (opts.isKnown?.(key)) { seen.add(key); reject(result, 'already known'); continue; }
        const ev = evaluateBrregRow(row, nace);
        if (!ev.keep) { reject(result, ev.reason); continue; }
        seen.add(key);
        result.candidates.push(toBrregLead(row, nace, ev));
        if (result.candidates.length >= max) return;
      }
      if (page + 1 >= p.totalPages) return;
    }
  };

  for (const nace of classes) {
    if (expired()) break;
    for (const form of opts.orgForms ?? BRREG_ORG_FORMS) {
      if (result.candidates.length >= max || expired()) break;
      try {
        await walkSlice(nace, form, BRREG_FULL_RANGE, 0);
      } catch (e) {
        // One slice failing must not cost the run the other slices.
        result.errors.push(`no brreg ${nace.code}/${form}: ${e instanceof Error ? e.message : String(e)}`);
      }
      opts.log?.(`no brreg ${nace.code}/${form}: running total scanned ${result.scanned}, candidates ${result.candidates.length}`);
    }
  }
  opts.log?.(`no brreg ${productId}: scanned ${result.scanned}, candidates ${result.candidates.length}`);
  return result;
}

export function allBrregLeads(productId: string, opts: BrregOpts = {}): Promise<RegistryResult> {
  return findBrregCandidates(productId, Number.MAX_SAFE_INTEGER, opts);
}
