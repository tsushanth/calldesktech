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
];

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

export function brregQueryUrl(naceCode: string, orgForm: string, page: number, size = 1000): string {
  const p = new URLSearchParams({ naeringskode: naceCode, organisasjonsform: orgForm, size: String(size), page: String(page) });
  return `${BRREG_API_URL}?${p.toString()}`;
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
  // Test seam: (naceCode, orgForm, page) -> page, instead of the network.
  fetchPage?: (naceCode: string, orgForm: string, page: number) => Promise<BrregPage>;
}

export async function findBrregCandidates(productId: string, max: number, opts: BrregOpts = {}): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  void now;
  const result = emptyResult();
  const classes = brregClassesFor(productId);
  if (!classes.length) {
    result.errors.push(`no brreg: no Norwegian industry code for ${productId}`);
    return result;
  }
  const size = opts.pageSize ?? 1000;
  const seen = new Set<string>();
  const get = opts.fetchPage ?? (async (code: string, form: string, page: number) => parseBrregPage(await fetchJson(brregQueryUrl(code, form, page, size), opts.timeoutMs ?? 60_000)));

  for (const nace of classes) {
    for (const form of opts.orgForms ?? BRREG_ORG_FORMS) {
      if (result.candidates.length >= max) break;
      try {
        // The number of pages the cap allows, whatever the total says.
        const maxPages = Math.ceil(BRREG_PAGE_CAP / size);
        for (let page = 0; page < maxPages; page++) {
          if (result.candidates.length >= max) break;
          const p = await get(nace.code, form, page);
          if (page === 0 && p.total > BRREG_PAGE_CAP) {
            result.errors.push(`no brreg ${nace.code}/${form}: ${p.total} results exceeds the API's ${BRREG_PAGE_CAP}-result window; narrow the query further (by kommunenummer) to reach them all`);
          }
          if (!p.entities.length) break;
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
            if (result.candidates.length >= max) break;
          }
          if (page + 1 >= p.totalPages) break;
        }
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
