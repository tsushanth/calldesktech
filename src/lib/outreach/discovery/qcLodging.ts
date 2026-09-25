import { cleanEmail, isFreeMail } from './freightFmcsa';
import { streamDelimitedRows } from './delimitedStream';
import {
  cityCountry, emptyResult, formatIntlPhone, reject, titleCase, type RegistryLead, type RegistryResult,
} from './registryCommon';
import { isCanadianPostcode } from './qcChildcare';
import { QC_ATTRIBUTION, QC_COUNTRY, QC_STATE } from './qcCommon';

// Lodging-vertical discovery from the THREE Tourisme Québec accommodation
// registers published on donneesquebec.ca under CC-BY 4.0, from the province's
// "Système d'information touristique" (SIT). Each establishment holds a tourist-
// accommodation registration number, which is the licence the lead is keyed on.
//
// Verified live 2026-09-24 (rows in the file, before filtering):
//   sit-quebec-campings              1,430  campgrounds and RV parks
//   sit-quebec-gites-touristiques      574  gîtes (bed and breakfasts)
//   sit-quebec-pourvoiries             830  pourvoiries (outfitters with lodging)
//
// All three are SEMICOLON-separated with EVERY field quoted, UTF-8. Their headers
// are nearly but not exactly the same (campings spells the address column
// "AdresseType", the other two "TypeAdresse", and pourvoiries has no "Environnement"
// column), so rows are mapped by column NAME and only the four columns every file
// shares are required.
//
// COUNTRY AND LANGUAGE: Canadian leads, `country` CA, `location` "<City>, QC" so
// the draft language resolves to Canadian French. Held like every non-US lead.

export interface QcLodgingFile {
  id: string; // slug, used in the lead key so the three files cannot collide
  url: string;
  datasetPage: string;
  registryName: string;
  // The English phrase the lead description uses; the file's GenreEtablissement is
  // French and a genre-specific label reads better than one generic word.
  fallbackLabel: string;
}

export const QC_LODGING_FILES: QcLodgingFile[] = [
  {
    id: 'campings',
    url: 'https://www.donneesquebec.ca/recherche/dataset/40064258-2c6b-44d5-8d1b-fdefd7590fbf/resource/fd890189-1633-405e-b0e5-594a57d487ac/download/sit-quebec-campings.csv',
    datasetPage: 'https://www.donneesquebec.ca/recherche/dataset/40064258-2c6b-44d5-8d1b-fdefd7590fbf',
    registryName: 'Tourisme Québec register of registered campgrounds (SIT — établissements de camping)',
    fallbackLabel: 'registered campground',
  },
  {
    id: 'gites',
    url: 'https://www.donneesquebec.ca/recherche/dataset/4abae523-83b7-4591-868c-aee836d8e9bc/resource/e3a84482-a18c-48da-8302-4aa393b8a6cf/download/sit-quebec-gites-touristiques.csv',
    datasetPage: 'https://www.donneesquebec.ca/recherche/dataset/4abae523-83b7-4591-868c-aee836d8e9bc',
    registryName: 'Tourisme Québec register of registered gîtes touristiques (SIT — gîtes)',
    fallbackLabel: 'registered gîte (bed and breakfast)',
  },
  {
    id: 'pourvoiries',
    url: 'https://www.donneesquebec.ca/recherche/dataset/f43fbfd7-2b40-4f40-99da-2e0ac1339012/resource/d2f8c9e6-cdb7-4faa-976f-2cac089ee692/download/sit-quebec-pourvoiries.csv',
    datasetPage: 'https://www.donneesquebec.ca/recherche/dataset/f43fbfd7-2b40-4f40-99da-2e0ac1339012',
    registryName: 'Tourisme Québec register of registered pourvoiries (SIT — pourvoiries)',
    fallbackLabel: 'registered pourvoirie (outfitter with lodging)',
  },
];

export const QC_LODGING_COLUMNS = {
  registration: 'NumeroEnregistrementHebergement',
  name: 'NomEtablissement',
  genre: 'GenreEtablissement',
  category: 'CategorieEtablissementHebergementTouristique',
  street: 'NumeroVoie',
  city: 'Municipalite',
  province: 'ProvinceEtat',
  postcode: 'CodePostal',
  country: 'Pays',
  region: 'RegionTouristique',
  phone: 'TelephonePrincipal',
  website: 'SiteInternet',
  email: 'Courriel',
} as const;

// Only the columns all three files share, so a layout change in one of them fails
// loudly rather than importing that file as blanks.
export const QC_LODGING_REQUIRED = [
  QC_LODGING_COLUMNS.registration, QC_LODGING_COLUMNS.name, QC_LODGING_COLUMNS.city, QC_LODGING_COLUMNS.email,
];

export interface QcLodgingRow {
  registration: string;
  name: string;
  genre: string | null;
  street: string | null;
  city: string | null;
  province: string | null;
  postcode: string | null;
  country: string | null;
  region: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
}

export function toQcLodgingRow(o: Record<string, string>): QcLodgingRow {
  const v = (k: string) => {
    const s = (o[k] ?? '').trim();
    return s || null;
  };
  return {
    registration: (v(QC_LODGING_COLUMNS.registration) ?? '').replace(/\D/g, ''),
    name: (v(QC_LODGING_COLUMNS.name) ?? '').replace(/\s+/g, ' '),
    genre: v(QC_LODGING_COLUMNS.genre),
    street: v(QC_LODGING_COLUMNS.street),
    city: v(QC_LODGING_COLUMNS.city),
    province: v(QC_LODGING_COLUMNS.province),
    postcode: v(QC_LODGING_COLUMNS.postcode),
    country: v(QC_LODGING_COLUMNS.country),
    region: v(QC_LODGING_COLUMNS.region),
    phone: v(QC_LODGING_COLUMNS.phone),
    website: v(QC_LODGING_COLUMNS.website),
    email: v(QC_LODGING_COLUMNS.email),
  };
}

// The French `GenreEtablissement` mapped to the English phrase the description
// states. Anything unrecognised falls back to the file's own label.
const GENRE_LABELS: [RegExp, string][] = [
  [/camping/i, 'registered campground'],
  [/g[îi]te/i, 'registered gîte (bed and breakfast)'],
  [/pourvoirie/i, 'registered pourvoirie (outfitter with lodging)'],
  [/auberge de jeunesse/i, 'registered youth hostel'],
  [/auberge/i, 'registered inn'],
  [/r[ée]sidence de tourisme|appartement/i, 'registered tourist residence'],
  [/[ée]tablissement h[ôo]telier|h[ôo]tel/i, 'registered hotel'],
  [/centre de vacances/i, 'registered holiday centre'],
  [/village d'accueil/i, 'registered host village'],
];

export function qcLodgingLabel(genre: string | null, fallback: string): string {
  return GENRE_LABELS.find(([p]) => p.test(genre ?? ''))?.[1] ?? fallback;
}

// The hotel chains, the campground franchises and the online travel platforms, plus
// the public bodies that run campgrounds in Québec (SÉPAQ runs the national parks
// and is not a small business). Mirrors the lodging vertical's score vocabulary.
const BIG_QC_LODGING = /\b(s[ée]paq|parcs? canada|soci[ée]t[ée] des [ée]tablissements de plein air|\bkoa\b|kampgrounds of america|marriott|hilton|hyatt|\bihg\b|wyndham|choice hotels|best western|holiday inn|radisson|accor|fairmont|delta hotels|sandman|coast hotels|group?e germain|hotels gouverneur|\bvrbo\b|airbnb|booking\.com|expedia|club med|\bzec\b|r[ée]serve faunique|ville de|municipalit[ée] de|\bmrc\b de)\b/i;

export type Evaluation =
  | { keep: true; adjust: number; reasons: string[]; typeLabel: string }
  | { keep: false; reason: string };

export function evaluateQcLodgingRow(row: QcLodgingRow, file: QcLodgingFile): Evaluation {
  if (!row.name) return { keep: false, reason: 'no establishment name' };
  if (!row.registration) return { keep: false, reason: 'no tourist-accommodation registration number' };
  if (!row.city) return { keep: false, reason: 'no municipality' };
  // The register is Québec-only, but the country column exists, so it is checked.
  if (row.country && !/^canada$/i.test(row.country)) return { keep: false, reason: 'establishment is not in Canada' };
  if (!cleanEmail(row.email)) return { keep: false, reason: 'no usable email in the register' };
  if (BIG_QC_LODGING.test(row.name)) return { keep: false, reason: 'hotel chain, campground franchise, travel platform or public park authority' };

  const typeLabel = qcLodgingLabel(row.genre, file.fallbackLabel);

  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };

  add(3, `holds Québec tourist-accommodation registration ${row.registration} as a ${typeLabel}`);

  const email = cleanEmail(row.email);
  if (email && !isFreeMail(email)) add(5, 'business-domain email address published in the register');
  else if (email) add(-8, 'contact is a free-mail address (common for an owner-run property; no business domain to verify)');

  if (row.website) add(3, 'publishes its own website in the register');
  if (formatIntlPhone(row.phone)) add(2, 'publishes a phone number in the register');
  // A missing postal code is common for a remote pourvoirie and is not a reason to
  // drop it; a present-but-malformed one is a data problem worth noting.
  if (row.postcode && !isCanadianPostcode(row.postcode)) add(-2, 'postal code in the register is malformed');

  return { keep: true, adjust, reasons, typeLabel };
}

export function qcLodgingSourceKey(row: QcLodgingRow): string {
  // The registration number is province-wide unique, so it alone is the key: the
  // same property must not become two leads if it ever appears in two of the files.
  return `lodging:qc:${row.registration}`;
}

// "https://www.example.ca/x" -> "example.ca"; null if unusable.
export function qcLodgingDomain(raw: string | null): string | null {
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

export function toQcLodgingLead(row: QcLodgingRow, file: QcLodgingFile, ev: Extract<Evaluation, { keep: true }>): RegistryLead {
  const name = titleCase(row.name);
  const location = cityCountry(row.city, QC_STATE);
  const phone = formatIntlPhone(row.phone);
  const email = cleanEmail(row.email);
  let description = `Listed in the Québec tourist-accommodation register as a ${ev.typeLabel}`;
  if (location) description += `, based in ${location}`;
  return {
    sourceKey: qcLodgingSourceKey(row),
    name,
    legalName: row.name !== name ? row.name : null,
    city: row.city ? titleCase(row.city) : null,
    state: QC_STATE,
    phone,
    licenseId: row.registration,
    registryName: file.registryName,
    typeLabel: ev.typeLabel,
    contactName: null,
    location,
    description: `${description}.`,
    signalDetail: `Tourist-accommodation registration ${row.registration}${row.region ? `, ${row.region}` : ''}; ${QC_ATTRIBUTION(file.registryName)}${phone ? `; register phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email,
    // A published website is more reliable than an email's domain, and free-mail
    // yields no domain at all, so the register's own site wins where there is one.
    domain: qcLodgingDomain(row.website),
    contactSourceUrl: email ? file.datasetPage : null,
    country: QC_COUNTRY,
  };
}

export interface QcLodgingOpts {
  isKnown?: (sourceKey: string) => boolean;
  log?: (m: string) => void;
  timeoutMs?: number;
  files?: QcLodgingFile[];
  // Test seam: rows per file id instead of the network.
  rowsOverride?: Record<string, Record<string, string>[]>;
}

export async function findQcLodgingCandidates(max: number, opts: QcLodgingOpts = {}): Promise<RegistryResult> {
  const result = emptyResult();
  const seen = new Set<string>();
  const seenEmails = new Set<string>();
  const files = opts.files ?? QC_LODGING_FILES;

  const handle = (o: Record<string, string>, file: QcLodgingFile): boolean => {
    if (result.candidates.length >= max) return false;
    result.scanned++;
    const row = toQcLodgingRow(o);
    const key = qcLodgingSourceKey(row);
    if (row.registration && seen.has(key)) { reject(result, 'duplicate registration number'); return true; }
    if (opts.isKnown?.(key)) { seen.add(key); reject(result, 'already known'); return true; }
    const ev = evaluateQcLodgingRow(row, file);
    if (!ev.keep) { reject(result, ev.reason); return true; }
    const lead = toQcLodgingLead(row, file, ev);
    if (lead.email) {
      if (seenEmails.has(lead.email)) { reject(result, 'shared mailbox with a property already kept'); return true; }
      seenEmails.add(lead.email);
    }
    seen.add(key);
    result.candidates.push(lead);
    return result.candidates.length < max;
  };

  for (const file of files) {
    if (result.candidates.length >= max) break;
    try {
      const override = opts.rowsOverride?.[file.id];
      if (override) {
        for (const o of override) if (handle(o, file) === false) break;
      } else {
        await streamDelimitedRows({
          url: file.url,
          delimiter: 'semicolon',
          requiredColumns: QC_LODGING_REQUIRED,
          minRows: 100,
          timeoutMs: opts.timeoutMs ?? 180_000,
          log: opts.log,
          onRow: (o) => handle(o, file),
        });
      }
      opts.log?.(`qc lodging ${file.id}: running total scanned ${result.scanned}, candidates ${result.candidates.length}`);
    } catch (e) {
      // One of the three files failing must not cost the run the other two.
      result.errors.push(`qc lodging ${file.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  opts.log?.(`qc lodging: scanned ${result.scanned}, candidates ${result.candidates.length}`);
  return result;
}

export function allQcLodgingLeads(opts: QcLodgingOpts = {}): Promise<RegistryResult> {
  return findQcLodgingCandidates(Number.MAX_SAFE_INTEGER, opts);
}
