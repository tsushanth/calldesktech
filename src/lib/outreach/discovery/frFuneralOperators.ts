import { cleanEmail, isFreeMail } from './freightFmcsa';
import { streamDelimitedRows } from './delimitedStream';
import { DISCOVERY_UA } from './http';
import { isFrenchPostcode } from './frRgeRegistry';
import {
  cityCountry, emptyResult, formatIntlPhone, reject, titleCase, type RegistryLead, type RegistryResult,
} from './registryCommon';

// Funeral-vertical discovery from the FRENCH national list of authorised funeral
// operators ("liste des opérateurs funéraires habilités"), compiled by the DGCL
// (Direction générale des collectivités locales) from the préfectures'
// habilitations and published on data.gouv.fr.
//
// Verified live 2026-09-24 against the 30-07-2026 edition: 9,529 rows, 9,424 with
// an email in `Courriel de l'établissement` (98.9%) and 8,171 with a landline
// (85.7%). Semicolon-separated, RFC-4180 quoted (only a handful of fields actually
// carry a quote), and NOT UTF-8 — it is cp1252/windows-1252, so "Samoëns" decodes
// to mojibake under UTF-8 and website discovery then cannot match the name.
//
// ============================================================================
// LICENCE: THE DATASET DECLARES ITS LICENCE AS "notspecified".
// ============================================================================
// Unlike every other source here (NLOD for Norway, Licence Ouverte for the RGE
// register, OGL for the UK, CC-BY for Québec), this dataset carries NO stated
// licence. That means we have no published permission to reuse it, and reuse terms
// MUST be confirmed with the DGCL before any lead from it is released from the
// international hold. Ingesting it is safe on its own — every lead lands
// region_blocked with signals.intlHold and is completely inert (see
// registryCommon.INTL_HOLD_REASON) — but France must NOT be released for the
// funeral vertical on the strength of the RGE register's Licence Ouverte, because
// this is a different dataset under different (unstated) terms. See the note in
// harness/outreach/README.md.
// ============================================================================
//
// TONE. The funeral vertical's product config forbids sales language of any kind
// (see products.ts: no benefits framing, no urgency, no "missed calls", and a
// bereaved family is never a "customer" or a "lead"). The lead description written
// here is therefore a plain factual sentence about the public record and nothing
// else, exactly as the other registry sources do.
//
// EVERY lead from here is stored ON HOLD (region_blocked + signals.intlHold).

export const FR_FUNERAL_DATASET_ID = '6867d3be1c287bc7c192ce4d';
export const FR_FUNERAL_DATASET_API = `https://www.data.gouv.fr/api/1/datasets/${FR_FUNERAL_DATASET_ID}/`;
export const FR_FUNERAL_DATASET_PAGE = `https://www.data.gouv.fr/fr/datasets/${FR_FUNERAL_DATASET_ID}/`;
export const FR_FUNERAL_REGISTRY = 'French national list of authorised funeral operators (liste des opérateurs funéraires habilités)';
// The edition verified on 2026-09-24. Only a fallback: resolveFrFuneralCsvUrl()
// asks the data.gouv.fr API for the newest CSV resource, because a new edition is
// published roughly twice a year under a new dated path.
export const FR_FUNERAL_FALLBACK_CSV = 'https://static.data.gouv.fr/resources/liste-des-operateurs-funeraires/20260804-124633/liste-des-operateurs-funeraires-habilites-30-07-2026.csv';

export const FR_FUNERAL_COLUMNS = {
  name: 'Raison sociale',
  address: 'Adresse *',
  address2: 'Complément adresse',
  city: 'Ville *',
  postcode: 'Code postal *',
  email: "Courriel de l'établissement",
  phone: "Téléphone de l'établissement",
  mobile: 'Mobile',
  services: 'Prestations',
} as const;

// The columns a run refuses to proceed without: if the DGCL renames one, the
// stream fails with "header row ... not found" instead of importing blanks.
export const FR_FUNERAL_REQUIRED = [FR_FUNERAL_COLUMNS.name, FR_FUNERAL_COLUMNS.city, FR_FUNERAL_COLUMNS.postcode, FR_FUNERAL_COLUMNS.email];

export interface FrFuneralRow {
  name: string;
  address: string | null;
  city: string | null;
  postcode: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  services: string | null;
}

export function toFrFuneralRow(o: Record<string, string>): FrFuneralRow {
  const v = (k: string) => {
    const s = (o[k] ?? '').trim();
    return s || null;
  };
  const addr = [v(FR_FUNERAL_COLUMNS.address), v(FR_FUNERAL_COLUMNS.address2)].filter(Boolean).join(', ');
  return {
    name: (v(FR_FUNERAL_COLUMNS.name) ?? '').replace(/\s+/g, ' '),
    address: addr || null,
    city: v(FR_FUNERAL_COLUMNS.city),
    postcode: v(FR_FUNERAL_COLUMNS.postcode),
    email: v(FR_FUNERAL_COLUMNS.email),
    phone: v(FR_FUNERAL_COLUMNS.phone),
    mobile: v(FR_FUNERAL_COLUMNS.mobile),
    services: v(FR_FUNERAL_COLUMNS.services),
  };
}

// `Prestations` is a comma-joined list of the habilitation's authorised services.
// Mapped to the one English phrase the description states, in priority order: an
// operator that organises funerals is the one the vertical is for.
const SERVICE_LABELS: { pattern: RegExp; label: string; adjust: number; why: string }[] = [
  { pattern: /organisation des obs[èe]ques/i, label: 'funeral director', adjust: 4, why: 'authorised to organise funerals (l’organisation des obsèques)' },
  { pattern: /gestion d'un cr[ée]matorium|cr[ée]matorium/i, label: 'crematorium operator', adjust: 2, why: 'authorised to operate a crematorium' },
  { pattern: /chambres? fun[ée]raires?/i, label: 'funeral home operator', adjust: 2, why: 'authorised to run a funeral chamber (chambre funéraire)' },
  { pattern: /transport des corps/i, label: 'funeral transport operator', adjust: 0, why: 'authorised to transport the deceased' },
  { pattern: /fourniture des corbillards|voitures de deuil/i, label: 'funeral transport operator', adjust: 0, why: 'authorised to provide hearses and mourning cars' },
  // A thanatopraxie-only habilitation is an embalmer working for other operators,
  // not a business whose own phone a bereaved family calls, so it is kept but
  // scored well down rather than presented as a funeral home.
  { pattern: /soins de conservation/i, label: 'thanatopractic (embalming) service', adjust: -14, why: 'holds only a thanatopraxie (embalming) habilitation, so it is a service supplier to other operators rather than a funeral home' },
];

// The national funeral groups and consolidators, plus the bank/insurer-owned
// networks. Matches the funeral vertical's own score vocabulary in products.ts,
// widened to the French market.
const BIG_FR_FUNERAL = /\b(ogf\b|pompes fun[èe]bres g[ée]n[ée]rales|\bpfg\b|funecap|roc ?[ée]clerc|le ?choix ?fun[ée]raire|le vœu|dignit[ée] ?memorial|service corporation|\bpfi\b ?gaillard|france obs[èe]ques|cr[ée]dit mutuel|\bcnp\b|axa\b|allianz|generali|groupama|macif|maif\b|matmut|ag2r|malakoff|carrefour|leclerc|auchan|point funeraire|cofidis)\b/i;

// A municipality, an inter-communal authority or a public crematorium régie. These
// are public bodies, not independent funeral homes, and the whole point of the
// vertical is the independent director who has no night switchboard.
const PUBLIC_FR = /^(ville de|commune de|mairie|communaut[ée] (de communes|d'agglom[ée]ration|urbaine)|m[ée]tropole|syndicat|s(ivo|ivu|ivom|ictom)\b|r[ée]gie |ccas\b|centre communal|d[ée]partement|conseil d[ée]partemental)/i;

export type Evaluation =
  | { keep: true; adjust: number; reasons: string[]; typeLabel: string }
  | { keep: false; reason: string };

export function evaluateFrFuneralRow(row: FrFuneralRow): Evaluation {
  if (!row.name) return { keep: false, reason: 'no company name' };
  if (!row.city) return { keep: false, reason: 'no commune' };
  // The file is metropolitan France plus the overseas departments; a postcode
  // outside 01000-98999 is a malformed or foreign row (see frRgeRegistry).
  if (!isFrenchPostcode(row.postcode)) return { keep: false, reason: 'postcode is not a French one (foreign establishment or placeholder row)' };
  if (BIG_FR_FUNERAL.test(row.name)) return { keep: false, reason: 'national funeral group, consolidator or insurer-owned network' };
  if (PUBLIC_FR.test(row.name)) return { keep: false, reason: 'municipality, inter-communal authority or public régie, not an independent operator' };

  const service = SERVICE_LABELS.find((s) => s.pattern.test(row.services ?? ''));
  if (!service) return { keep: false, reason: 'habilitation lists no recognised funeral service' };

  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };

  add(3, 'holds a préfecture habilitation as a funeral operator');
  if (service.adjust !== 0) add(service.adjust, service.why);
  else reasons.push(`0: ${service.why}`);

  const email = cleanEmail(row.email);
  if (email && !isFreeMail(email)) add(5, 'business-domain email address published in the habilitation list');
  else if (email) add(-10, 'listed email is a free-mail address, so it is not used as the contact');

  if (formatIntlPhone(row.phone)) add(2, 'publishes a landline in the habilitation list');
  else if (formatIntlPhone(row.mobile)) add(-2, 'publishes only a mobile number, which reads as a one-person operation');

  return { keep: true, adjust, reasons, typeLabel: service.label };
}

// There is NO licence or registration number in this file — the habilitation
// number is not published — so the lead key is derived from the two fields that
// together identify an establishment: the normalised name and the postcode. Stable
// across editions as long as neither changes, which is what idempotent re-import
// needs.
export function frFuneralKeyPart(name: string, postcode: string | null): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${(postcode ?? '00000').replace(/\D/g, '')}-${slug}`;
}

export function frFuneralSourceKey(row: FrFuneralRow): string {
  return `funeral:fr:${frFuneralKeyPart(row.name, row.postcode)}`;
}

export function toFrFuneralLead(row: FrFuneralRow, ev: Extract<Evaluation, { keep: true }>): RegistryLead {
  const name = titleCase(row.name);
  const location = cityCountry(row.city, 'FR');
  const phone = formatIntlPhone(row.phone) ?? formatIntlPhone(row.mobile);
  const email = cleanEmail(row.email);
  const usableEmail = email && !isFreeMail(email) ? email : null;
  let description = `Listed in the French national list of authorised funeral operators as a ${ev.typeLabel}`;
  if (location) description += `, based in ${location}`;
  return {
    sourceKey: frFuneralSourceKey(row),
    name,
    legalName: row.name !== name ? row.name : null,
    city: row.city ? titleCase(row.city) : null,
    state: 'FR',
    phone,
    // No habilitation number is published, so the derived key doubles as the
    // licence identifier the reviewer sees in signals.registry.
    licenseId: frFuneralKeyPart(row.name, row.postcode),
    registryName: FR_FUNERAL_REGISTRY,
    typeLabel: ev.typeLabel,
    contactName: null,
    location,
    description: `${description}.`,
    // Licence recorded on every lead, because it is the thing a reviewer has to act
    // on before France can be released for this vertical.
    signalDetail: `Habilitation funéraire, ${row.postcode ?? '?'} ${row.city ?? '?'}; source data.gouv.fr dataset ${FR_FUNERAL_DATASET_ID}, licence "notspecified" — reuse terms to be confirmed with the DGCL${phone ? `; listed phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: usableEmail,
    contactSourceUrl: usableEmail ? FR_FUNERAL_DATASET_PAGE : null,
    country: 'FR',
  };
}

// ---- network ---------------------------------------------------------------

export interface DataGouvResource {
  format: string | null;
  url: string | null;
  lastModified: string | null;
  title: string | null;
}

export function parseDataGouvResources(body: unknown): DataGouvResource[] {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(b.resources) ? (b.resources as Record<string, unknown>[]) : [];
  return raw.map((r) => ({
    format: typeof r.format === 'string' ? r.format : null,
    url: typeof r.url === 'string' ? r.url : null,
    lastModified: typeof r.last_modified === 'string' ? r.last_modified : null,
    title: typeof r.title === 'string' ? r.title : null,
  }));
}

// The newest CSV resource. The dataset also publishes the same table as .xlsx,
// which we cannot read, and keeps every past edition, so "newest CSV" is the
// selection — not "first resource".
export function pickLatestCsv(resources: DataGouvResource[]): string | null {
  const csvs = resources.filter((r) => (r.format ?? '').toLowerCase() === 'csv' && r.url);
  if (!csvs.length) return null;
  csvs.sort((a, b) => (b.lastModified ?? '').localeCompare(a.lastModified ?? ''));
  return csvs[0].url;
}

export async function resolveFrFuneralCsvUrl(opts: { timeoutMs?: number; log?: (m: string) => void } = {}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(FR_FUNERAL_DATASET_API, { headers: { 'User-Agent': DISCOVERY_UA, Accept: 'application/json' }, signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const url = pickLatestCsv(parseDataGouvResources(await res.json()));
    if (!url) throw new Error('dataset has no CSV resource');
    return url;
  } catch (e) {
    // A pinned URL that is six months stale is much better than importing nothing.
    opts.log?.(`fr funeral: could not resolve the latest CSV (${e instanceof Error ? e.message : String(e)}); falling back to the pinned 30-07-2026 edition`);
    return FR_FUNERAL_FALLBACK_CSV;
  } finally {
    clearTimeout(timer);
  }
}

export interface FrFuneralOpts {
  isKnown?: (sourceKey: string) => boolean;
  log?: (m: string) => void;
  timeoutMs?: number;
  // Test seam: rows in order instead of the network.
  rowsOverride?: Record<string, string>[];
  urlOverride?: string;
}

export async function findFrFuneralCandidates(max: number, opts: FrFuneralOpts = {}): Promise<RegistryResult> {
  const result = emptyResult();
  const seen = new Set<string>();
  // One establishment can appear more than once (a second habilitation, or the
  // same operator listed by two préfectures), and a small operator's branches all
  // share one mailbox, so both the derived key and the email are deduped.
  const seenEmails = new Set<string>();

  const handle = (o: Record<string, string>): boolean => {
    if (result.candidates.length >= max) return false;
    result.scanned++;
    const row = toFrFuneralRow(o);
    const key = frFuneralSourceKey(row);
    if (seen.has(key)) { reject(result, 'duplicate operator (same name and postcode)'); return true; }
    if (opts.isKnown?.(key)) { seen.add(key); reject(result, 'already known'); return true; }
    const ev = evaluateFrFuneralRow(row);
    if (!ev.keep) { reject(result, ev.reason); return true; }
    const lead = toFrFuneralLead(row, ev);
    if (lead.email) {
      if (seenEmails.has(lead.email)) { reject(result, 'duplicate email (branch of an operator already kept)'); return true; }
      seenEmails.add(lead.email);
    }
    seen.add(key);
    result.candidates.push(lead);
    return result.candidates.length < max;
  };

  try {
    if (opts.rowsOverride) {
      for (const o of opts.rowsOverride) if (handle(o) === false) break;
    } else {
      const url = opts.urlOverride ?? (await resolveFrFuneralCsvUrl({ timeoutMs: opts.timeoutMs, log: opts.log }));
      opts.log?.(`fr funeral: streaming ${url}`);
      await streamDelimitedRows({
        url,
        delimiter: 'semicolon',
        // NOT UTF-8. Decoding as UTF-8 turns "Samoëns" into mojibake.
        encoding: 'windows-1252',
        requiredColumns: FR_FUNERAL_REQUIRED,
        minRows: 1000,
        timeoutMs: opts.timeoutMs ?? 180_000,
        log: opts.log,
        onRow: (o) => handle(o),
      });
    }
    opts.log?.(`fr funeral: scanned ${result.scanned}, candidates ${result.candidates.length}`);
  } catch (e) {
    result.errors.push(`fr funeral: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

export function allFrFuneralLeads(opts: FrFuneralOpts = {}): Promise<RegistryResult> {
  return findFrFuneralCandidates(Number.MAX_SAFE_INTEGER, opts);
}
