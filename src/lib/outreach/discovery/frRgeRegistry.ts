import { cleanEmail, isFreeMail } from './freightFmcsa';
import { DISCOVERY_UA } from './http';
import {
  cityCountry, emptyResult, formatIntlPhone, reject, titleCase, type RegistryLead, type RegistryResult,
} from './registryCommon';

// Home-services discovery from the FRENCH RGE register ("Reconnu Garant de
// l'Environnement"): the list of contractors qualified to carry out
// state-subsidised energy-renovation work. Published by ADEME on
// data.ademe.fr under the Licence Ouverte, no API key (verified 2026-09-24).
//
// This is the largest email-bearing source in the codebase: 159,727 rows, of
// which 157,830 carry an email address. It is also the only one with a
// latitude/longitude and a website column.
//
// EVERY lead from here is stored ON HOLD (region_blocked + signals.intlHold),
// because it is not a US lead — see registryCommon.INTL_HOLD_REASON. Nothing is
// drafted or sent until a human releases France.
//
// Practicalities:
//  * One row PER QUALIFICATION, not per business: a contractor holding six RGE
//    qualifications appears six times with the same SIRET. We therefore sort by
//    `siret` and dedupe as we stream, keeping the first (best-scoring trade) row
//    per SIREN — the first 9 digits of the SIRET, which identify the ENTERPRISE
//    rather than the individual establishment, so a chain's branches collapse to
//    one lead.
//  * The API is cursor-paged: each response carries a `next` URL with an
//    `after` token. Page/offset paging is capped, cursor paging is not.
//  * `email_exists=true` restricts the scan to the rows that have an email,
//    which is the only reason a full pass is affordable.

export const RGE_DATASET_URL = 'https://data.ademe.fr/data-fair/api/v1/datasets/liste-des-entreprises-rge-2/lines';
export const RGE_REGISTRY = 'French RGE (Reconnu Garant de l’Environnement) contractor register';
export const RGE_SOURCE_URL = 'https://france-renov.gouv.fr/annuaire-rge';

export interface RgeRow {
  siret: string;
  nom_entreprise: string;
  adresse: string | null;
  code_postal: string | null;
  commune: string | null;
  telephone: string | null;
  email: string | null;
  site_internet: string | null;
  code_qualification: string | null;
  nom_qualification: string | null;
  domaine: string | null;
  meta_domaine: string | null;
  organisme: string | null;
  lien_date_fin: string | null;
}

export function toRgeRow(o: Record<string, unknown>): RgeRow {
  const v = (k: string) => {
    const x = o[k];
    const s = typeof x === 'string' ? x.trim() : x == null ? '' : String(x).trim();
    return s || null;
  };
  return {
    siret: (v('siret') ?? '').replace(/\D/g, ''),
    nom_entreprise: (v('nom_entreprise') ?? '').replace(/\s+/g, ' '),
    adresse: v('adresse'),
    code_postal: v('code_postal'),
    commune: v('commune'),
    telephone: v('telephone'),
    email: v('email'),
    site_internet: v('site_internet'),
    code_qualification: v('code_qualification'),
    nom_qualification: v('nom_qualification'),
    domaine: v('domaine'),
    meta_domaine: v('meta_domaine'),
    organisme: v('organisme'),
    lien_date_fin: v('lien_date_fin'),
  };
}

// The `domaine` values that are a phone-driven INSTALLATION / SERVICE trade — the
// same HVAC / plumbing / electrical / roofing businesses the US home-services
// sources target. Matched against `domaine`, with the English trade words used in
// the lead description. (Counts across the register, 2026-09-24, in comments.)
const TRADE_DOMAINS: { pattern: RegExp; label: string }[] = [
  { pattern: /pompe à chaleur/i, label: 'heat-pump installer' }, // 15,673
  { pattern: /chauffe-eau thermodynamique/i, label: 'hot-water and heating installer' }, // 16,441
  { pattern: /^chaudière/i, label: 'boiler installer' }, // 6,056 + 3,771
  { pattern: /poêle ou insert/i, label: 'wood-heating installer' }, // 7,463
  { pattern: /ventilation mécanique/i, label: 'ventilation installer' }, // 6,732
  { pattern: /chauffage et\/ou eau chaude solaire/i, label: 'solar heating and hot-water installer' }, // 1,941
  { pattern: /radiateurs électriques/i, label: 'electrical heating installer' }, // 4,709
  { pattern: /panneaux solaires photovoltaïques/i, label: 'solar photovoltaic installer' }, // 6,293
  { pattern: /isolation des toitures|fenêtres de toit/i, label: 'roofing and roof-insulation contractor' }, // 7,354 + 6,788
  { pattern: /isolation des combles|isolation des murs|isolation par l'intérieur|isolation des planchers/i, label: 'insulation contractor' }, // 11,319 + 9,791 + 18,071 + 5,388
  { pattern: /fenêtres, volets, portes/i, label: 'window and door installer' }, // 14,468
];

// Study, audit, design and drilling qualifications. These are consultancies and
// engineers, not the phone-driven service businesses the vertical is for, and the
// dry run confirmed their contacts are mostly personal addresses. Checked FIRST,
// so a firm holding both a study and an installation qualification is still kept
// on its installation row.
const STUDY_DOMAIN = /^(etude|audit énergétique|architecte|commisionnement|projet complet|forage géothermique)/i;

// Large national installers, utilities and retail chains that hold RGE
// qualifications: not local service businesses. The equivalent of
// vaDporContractors.BIG_HOMESERVICES.
const BIG_FR = /\b(engie|edf\b|totalenergies|total direct|effy|hellio|leroy merlin|castorama|brico ?d[ée]p[ôo]t|point\.?p|saint[- ]gobain|bouygues|vinci|eiffage|spie\b|dalkia|veolia|suez\b|rexel|sonepar|somfy|daikin|atlantic|viessmann|vaillant|bosch|ariston|de dietrich|saunier duval|mitsubishi|panasonic|samsung|toshiba|ikea|darty|boulanger|fnac|carrefour|leclerc|auchan|sogeprom|nexity|eqinov|quelle ?énergie|sonergia|cdiscount|amzair|isoltoit|isolation france)\b/i;

// A personal name as the company name is the marker of an entreprise
// individuelle / auto-entrepreneur. Under GDPR a sole trader's business address
// is much closer to personal data, so those rows are flagged and scored down
// rather than being treated like a company. "M ", "MME ", "MLLE " prefixes and
// the explicit legal forms are what the register actually writes.
const SOLE_TRADER = /^(m|mme|mlle|mr|monsieur|madame)\s|^ent(reprise)? individuelle\b|\bei\b$|\beirl\b|\bauto[- ]entrepreneur\b/i;
// The corporate legal forms; their presence is positive evidence of a company.
const CORPORATE_FORM = /\b(sarl|sas|sasu|sa|scop|sci|snc|eurl|selarl|scm|sem|gie|groupe)\b/i;

export type Evaluation =
  | { keep: true; adjust: number; reasons: string[]; typeLabel: string }
  | { keep: false; reason: string };

// French metropolitan and overseas postcodes run 01000-98999. "00000" is what the
// register writes for a foreign address.
export function isFrenchPostcode(raw: string | null | undefined): boolean {
  const cp = (raw ?? '').trim();
  return /^\d{5}$/.test(cp) && cp.slice(0, 2) !== '00';
}

// "2099-01-01" / "2026-12-31" -> Date (the qualification's end date).
export function parseRgeDate(raw: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((raw ?? '').trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function evaluateRgeRow(r: RgeRow, now = new Date()): Evaluation {
  if (!r.nom_entreprise) return { keep: false, reason: 'no company name' };
  // The SIRET is 14 digits (9-digit SIREN + 5-digit establishment); anything else
  // is a malformed row we cannot key a lead on.
  if (r.siret.length !== 14) return { keep: false, reason: 'no valid SIRET' };
  if (!r.commune) return { keep: false, reason: 'no commune' };
  // The register also lists FOREIGN companies qualified to work in France. The dry
  // run found a Portuguese joinery with commune "RIBEIRAO", postcode "00000" and a
  // placeholder SIREN of all zeroes. Those must not be ingested as French leads:
  // the location would be wrong and the draft would be written in French to a
  // Portuguese company. French postcodes run 01000-98999, so requiring a real one
  // (and a real SIREN) keeps only French establishments.
  if (!isFrenchPostcode(r.code_postal)) return { keep: false, reason: 'postcode is not a French one (foreign establishment or placeholder row)' };
  if (/^0{9}$/.test(sirenOf(r.siret))) return { keep: false, reason: 'placeholder SIREN of all zeroes' };
  const end = parseRgeDate(r.lien_date_fin);
  if (!end || end.getTime() < now.getTime()) return { keep: false, reason: 'qualification expired' };
  if (STUDY_DOMAIN.test(r.domaine ?? '')) return { keep: false, reason: 'study/audit/architect qualification, not an installation trade' };
  if (BIG_FR.test(r.nom_entreprise)) return { keep: false, reason: 'national installer, utility or retail chain name' };
  const trade = TRADE_DOMAINS.find((t) => t.pattern.test(r.domaine ?? ''));
  if (!trade) return { keep: false, reason: 'qualification is not an HVAC/plumbing/electrical/roofing/insulation trade' };

  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };

  add(3, `holds the RGE "${r.nom_qualification ?? r.domaine}" qualification`);

  const email = cleanEmail(r.email);
  if (email && !isFreeMail(email)) add(5, 'business-domain email address published in the register');
  else if (email) add(-10, 'register email is a free-mail address (likely a one-person shop), so it is not used as the contact');

  if (r.site_internet) add(3, 'publishes its own website in the register');
  if (formatIntlPhone(r.telephone)) add(2, 'publishes a phone number in the register');

  if (SOLE_TRADER.test(r.nom_entreprise)) add(-12, 'name reads as an entreprise individuelle / sole trader (personal-data risk, and too small)');
  else if (CORPORATE_FORM.test(r.nom_entreprise)) add(3, 'registered as a French company (SARL/SAS/SA form)');

  return { keep: true, adjust, reasons, typeLabel: trade.label };
}

// The SIREN (enterprise) part of a SIRET; the lead key, so a company's branches
// collapse to one lead.
export function sirenOf(siret: string): string {
  return siret.replace(/\D/g, '').slice(0, 9);
}

export function rgeSourceKey(siret: string): string {
  return `homeservices:fr:${sirenOf(siret)}`;
}

export function toRgeLead(r: RgeRow, ev: Extract<Evaluation, { keep: true }>): RegistryLead {
  const name = titleCase(r.nom_entreprise);
  const city = r.commune ? titleCase(r.commune) : null;
  const location = cityCountry(r.commune, 'FR');
  const phone = formatIntlPhone(r.telephone);
  const email = cleanEmail(r.email);
  const usableEmail = email && !isFreeMail(email) ? email : null;
  // Wording fixed by the compliance review: the description may state only what
  // the register itself supports.
  let description = `Listed in the French RGE (Reconnu Garant de l’Environnement) contractor register as a ${ev.typeLabel}`;
  if (location) description += `, based in ${location}`;
  return {
    sourceKey: rgeSourceKey(r.siret),
    name,
    legalName: r.nom_entreprise !== name ? r.nom_entreprise : null,
    city,
    state: 'FR',
    phone,
    licenseId: r.siret,
    registryName: RGE_REGISTRY,
    typeLabel: ev.typeLabel,
    contactName: null,
    location,
    description: `${description}.`,
    signalDetail: `RGE qualification ${r.code_qualification ?? '?'} (${r.domaine ?? '?'}) via ${r.organisme ?? 'ADEME'}, SIRET ${r.siret}${phone ? `; register phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: usableEmail,
    contactSourceUrl: usableEmail ? RGE_SOURCE_URL : null,
    country: 'FR',
  };
}

// ---- network ---------------------------------------------------------------

export interface RgePage {
  total: number;
  next: string | null;
  results: Record<string, unknown>[];
}

export function parseRgePage(body: unknown): RgePage {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(b.results)) throw new Error('RGE API response has no results array');
  return {
    total: typeof b.total === 'number' ? b.total : 0,
    next: typeof b.next === 'string' && b.next ? b.next : null,
    results: b.results as Record<string, unknown>[],
  };
}

const SELECT = [
  'siret', 'nom_entreprise', 'adresse', 'code_postal', 'commune', 'telephone', 'email',
  'site_internet', 'code_qualification', 'nom_qualification', 'domaine', 'meta_domaine',
  'organisme', 'lien_date_fin',
].join(',');

// Sorting by siret is what makes the streaming SIREN dedupe correct: every row
// for one enterprise arrives adjacent, so only the current SIREN has to be held.
export function rgeFirstPageUrl(opts: { pageSize?: number; emailOnly?: boolean } = {}): string {
  const p = new URLSearchParams({ size: String(opts.pageSize ?? 1000), select: SELECT, sort: 'siret' });
  if (opts.emailOnly !== false) p.set('email_exists', 'true');
  return `${RGE_DATASET_URL}?${p.toString()}`;
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': DISCOVERY_UA, Accept: 'application/json' }, signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`RGE API unavailable (HTTP ${res.status})`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export interface RgeOpts {
  now?: Date;
  isKnown?: (sourceKey: string) => boolean;
  log?: (m: string) => void;
  pageSize?: number;
  maxPages?: number;
  timeoutMs?: number;
  // Test seam: pages in order instead of the network.
  pagesOverride?: RgePage[];
}

// One cursor-paged pass, deduped on SIREN as it goes. `max` caps the candidates
// kept (Number.MAX_SAFE_INTEGER for the bulk import).
export async function findRgeCandidates(max: number, opts: RgeOpts = {}): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();
  // Best row seen so far for the SIREN currently being accumulated, plus the set
  // of SIRENs already emitted (a defence in case the sort is not perfectly
  // stable across pages).
  const emitted = new Set<string>();
  let current: { siren: string; lead: RegistryLead; adjust: number } | null = null;
  const flush = () => {
    if (!current) return;
    if (!emitted.has(current.siren) && result.candidates.length < max) {
      emitted.add(current.siren);
      result.candidates.push(current.lead);
    }
    current = null;
  };

  try {
    const maxPages = opts.maxPages ?? 400;
    let page: RgePage | null = null;
    let url: string | null = rgeFirstPageUrl({ pageSize: opts.pageSize });
    for (let i = 0; i < maxPages && result.candidates.length < max; i++) {
      if (opts.pagesOverride) {
        page = opts.pagesOverride[i] ?? null;
      } else {
        if (!url) break;
        page = parseRgePage(await fetchJson(url, opts.timeoutMs ?? 60_000));
      }
      if (!page) break;
      if (i === 0 && page.total < 1000 && !opts.pagesOverride) throw new Error(`RGE API returned only ${page.total} rows; dataset or filter may have changed`);
      if (!page.results.length) break;
      for (const raw of page.results) {
        result.scanned++;
        const r = toRgeRow(raw);
        const siren = sirenOf(r.siret);
        if (current && current.siren !== siren) flush();
        if (result.candidates.length >= max) break;
        // Already emitted or already a lead -> skip the whole enterprise.
        if (emitted.has(siren)) { reject(result, 'duplicate SIREN'); continue; }
        if (current && current.siren === siren) {
          // Another qualification for the enterprise being accumulated: keep it
          // only if it scores better than the row already held.
          const ev = evaluateRgeRow(r, now);
          if (ev.keep && ev.adjust > current.adjust) current = { siren, lead: toRgeLead(r, ev), adjust: ev.adjust };
          else if (!ev.keep) reject(result, 'duplicate SIREN');
          continue;
        }
        if (opts.isKnown?.(rgeSourceKey(r.siret))) { reject(result, 'already known'); continue; }
        const ev = evaluateRgeRow(r, now);
        if (!ev.keep) { reject(result, ev.reason); continue; }
        current = { siren, lead: toRgeLead(r, ev), adjust: ev.adjust };
      }
      url = page.next;
      if (!opts.pagesOverride && !url) break;
      if (i > 0 && i % 25 === 0) opts.log?.(`fr rge: ${result.scanned} rows scanned, ${result.candidates.length} candidates`);
    }
    flush();
    opts.log?.(`fr rge: scanned ${result.scanned}, candidates ${result.candidates.length}`);
  } catch (e) {
    flush();
    result.errors.push(`fr rge: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

export function allRgeLeads(opts: RgeOpts = {}): Promise<RegistryResult> {
  return findRgeCandidates(Number.MAX_SAFE_INTEGER, opts);
}
