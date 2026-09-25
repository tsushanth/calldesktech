import { cleanEmail, isFreeMail } from './freightFmcsa';
import { streamDelimitedRows } from './delimitedStream';
import {
  cityCountry, emptyResult, formatIntlPhone, reject, titleCase, type RegistryLead, type RegistryResult,
} from './registryCommon';
import { QC_ATTRIBUTION, QC_COUNTRY, QC_LICENCE, QC_STATE } from './qcCommon';

// Child-care discovery from the QUÉBEC provincial directory of CPEs and garderies
// ("Répertoire des installations — centres de la petite enfance et garderies"),
// published by the Ministère de la Famille on donneesquebec.ca under CC-BY 4.0.
//
// Verified live 2026-09-24: 3,811 installations (1,823 CPE, 1,988 garderies), 3,806
// with an email in the INTERNET column — but only 2,824 DISTINCT emails, because a
// CPE is a corporation that runs several installations and they all share one
// mailbox and often one street address. Deduping on the email is therefore not an
// optimisation here, it is the difference between 2,824 leads and 3,806 duplicate
// approaches to the same director.
//
// Comma CSV, UTF-8 with a BOM. The column that holds the EMAIL is called INTERNET
// (it is not a website; the directory has no website column).
//
// COUNTRY AND LANGUAGE. These are Canadian leads: `country` is CA, so the
// international hold applies and release-country.ts releases them with COUNTRY=CA.
// The lead's `location` is written "<City>, QC", which is what language.ts reads to
// pick CANADIAN French (fr-CA) rather than France French — see the Québec entry in
// COUNTRY_CODE_LANGUAGE. CASL (Canada's anti-spam law) is consent-based and has not
// been reviewed, which is exactly what the hold is for.
//
// EVERY lead from here is stored ON HOLD (region_blocked + signals.intlHold).
//
// FREE-MAIL. Same decision as childcareUs.ts, for the same reason and more so: 40%
// of the directory's mailboxes are gmail/hotmail/videotron/bellnet, because an
// owner-run garderie genuinely runs on one. Dropping them would throw away the
// smallest, most owner-run half of the vertical's best-fitting population, so a
// free-mail address IS kept as the contact and scored down instead;
// pipeline.registryLeadRow already refuses to treat it as a business domain.

export const QC_CPE_CSV_URL = 'https://www.donneesquebec.ca/recherche/dataset/be36f85e-e419-4978-9c34-cb5795622595/resource/89af3537-4506-488c-8d0e-6d85b4033a0e/download/repertoire-installation.csv';
export const QC_CPE_DATASET_PAGE = 'https://www.donneesquebec.ca/recherche/dataset/be36f85e-e419-4978-9c34-cb5795622595';
export const QC_CPE_REGISTRY = 'Québec Ministère de la Famille directory of child care centres and garderies (Répertoire des installations)';

export const QC_CPE_COLUMNS = {
  name: 'NOM',
  type: 'TYPE',
  address: 'ADRESSE',
  city: 'NOM_MUN_COMPO',
  postcode: 'CODE_POSTAL_COMPO',
  region: 'REGION',
  places: 'PLACE_TOTAL',
  subsidised: 'SUBV',
  phone: 'telephone1',
  email: 'INTERNET',
} as const;

export const QC_CPE_REQUIRED = [QC_CPE_COLUMNS.name, QC_CPE_COLUMNS.type, QC_CPE_COLUMNS.city, QC_CPE_COLUMNS.email];

export interface QcCpeRow {
  name: string;
  type: string | null; // "CPE" | "GARD"
  address: string | null;
  city: string | null;
  postcode: string | null;
  region: string | null;
  places: number | null;
  subsidised: boolean;
  phone: string | null;
  email: string | null;
}

export function toQcCpeRow(o: Record<string, string>): QcCpeRow {
  const v = (k: string) => {
    const s = (o[k] ?? '').trim();
    return s || null;
  };
  const places = Number((v(QC_CPE_COLUMNS.places) ?? '').replace(/\D/g, ''));
  return {
    name: (v(QC_CPE_COLUMNS.name) ?? '').replace(/\s+/g, ' '),
    type: (v(QC_CPE_COLUMNS.type) ?? '').toUpperCase() || null,
    address: v(QC_CPE_COLUMNS.address),
    city: v(QC_CPE_COLUMNS.city),
    postcode: v(QC_CPE_COLUMNS.postcode),
    region: v(QC_CPE_COLUMNS.region),
    places: Number.isFinite(places) && places > 0 ? places : null,
    // "CR" marks a subsidised ("contribution réduite") place; blank means a private
    // garderie at market rates.
    subsidised: (v(QC_CPE_COLUMNS.subsidised) ?? '').toUpperCase() === 'CR',
    phone: v(QC_CPE_COLUMNS.phone),
    email: v(QC_CPE_COLUMNS.email),
  };
}

// A Canadian postal code, "G5J 3H7" or "G5J3H7". Rejects the blank and malformed
// values, and confirms the row really is a Québec address.
export function isCanadianPostcode(raw: string | null | undefined): boolean {
  return /^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/.test((raw ?? '').trim());
}

// School boards, the Cree/Kativik regional authorities and the municipal and
// hospital-run installations: public bodies, not owner-run centres. Mirrors the
// childcare vertical's own score vocabulary in products.ts, in French.
const PUBLIC_QC = /\b(commission scolaire|centre de services scolaire|\bcss\b|cscn|school board|kativik|cree school|krg\b|conseil (cri|de bande)|\bcisss\b|\bciusss\b|centre hospitalier|h[ôo]pital|universit[ée]|c[ée]gep|coll[èe]ge\b|ville de|municipalit[ée] de|mrc de|\bymca\b|\bywca\b|arm[ée]e du salut|centre jeunesse)\b/i;

export type Evaluation =
  | { keep: true; adjust: number; reasons: string[]; typeLabel: string }
  | { keep: false; reason: string };

export function evaluateQcCpeRow(row: QcCpeRow): Evaluation {
  if (!row.name) return { keep: false, reason: 'no installation name' };
  if (!row.city) return { keep: false, reason: 'no municipality' };
  if (!isCanadianPostcode(row.postcode)) return { keep: false, reason: 'no valid Canadian postal code' };
  if (!cleanEmail(row.email)) return { keep: false, reason: 'no usable email in the directory' };
  if (PUBLIC_QC.test(row.name)) return { keep: false, reason: 'school board, regional authority, health body or large non-profit rather than an owner-run centre' };

  const isCpe = row.type === 'CPE';
  const typeLabel = isCpe ? 'centre de la petite enfance (CPE)' : 'garderie (private child care centre)';

  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };

  add(3, `listed in the Québec Ministère de la Famille directory as a ${typeLabel}`);

  // A CPE is a non-profit corporation with a board and, usually, several
  // installations sharing one office; a garderie is the privately owned,
  // owner-run business the vertical is actually written for.
  if (isCpe) add(-4, 'a CPE is a non-profit corporation with a board, so the decision is not one owner’s');
  else add(3, 'a privately owned garderie, so there is an owner who answers the phone');

  const email = cleanEmail(row.email);
  if (email && !isFreeMail(email)) add(5, 'business-domain email address published in the directory');
  else if (email) add(-8, 'contact is a free-mail address (common for a small or home-based garderie; no business domain to verify)');

  if (formatIntlPhone(row.phone)) add(2, 'publishes a phone number in the directory');

  const n = row.places;
  if (n != null && n >= 150) add(-12, `${n} licensed places (too large to be owner-run)`);
  else if (n != null && n >= 20) add(2, `${n} licensed places (an established small centre)`);

  if (row.subsidised) add(1, 'holds subsidised (contribution réduite) places, so it is an established licence holder');

  return { keep: true, adjust, reasons, typeLabel };
}

// No permit number is published in this export, so the lead key is the normalised
// name plus the postal code — the pair that identifies an installation.
export function qcCpeKeyPart(name: string, postcode: string | null): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${(postcode ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'XXXXXX'}-${slug}`;
}

export function qcCpeSourceKey(row: QcCpeRow): string {
  return `childcare:qc:${qcCpeKeyPart(row.name, row.postcode)}`;
}

export function toQcCpeLead(row: QcCpeRow, ev: Extract<Evaluation, { keep: true }>): RegistryLead {
  const name = titleCase(row.name);
  // "Québec City, QC" — the QC code is what language.ts maps to Canadian French.
  const location = cityCountry(row.city, QC_STATE);
  const phone = formatIntlPhone(row.phone);
  const email = cleanEmail(row.email);
  let description = `Listed in the Québec Ministère de la Famille directory of child care centres as a ${ev.typeLabel}`;
  if (location) description += `, based in ${location}`;
  return {
    sourceKey: qcCpeSourceKey(row),
    name,
    legalName: row.name !== name ? row.name : null,
    city: row.city ? titleCase(row.city) : null,
    state: QC_STATE,
    phone,
    licenseId: qcCpeKeyPart(row.name, row.postcode),
    registryName: QC_CPE_REGISTRY,
    typeLabel: ev.typeLabel,
    contactName: null,
    location,
    description: `${description}.`,
    signalDetail: `${row.type ?? '?'} in ${row.region ?? 'Québec'}${row.places ? `, ${row.places} places` : ''}; ${QC_ATTRIBUTION(QC_CPE_REGISTRY)}${phone ? `; directory phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    // Free-mail is kept as the contact on purpose (see the header comment); the
    // pipeline refuses to derive a domain from it.
    email,
    contactSourceUrl: email ? QC_CPE_DATASET_PAGE : null,
    country: QC_COUNTRY,
  };
}

export interface QcCpeOpts {
  isKnown?: (sourceKey: string) => boolean;
  log?: (m: string) => void;
  timeoutMs?: number;
  rowsOverride?: Record<string, string>[];
  urlOverride?: string;
}

export async function findQcCpeCandidates(max: number, opts: QcCpeOpts = {}): Promise<RegistryResult> {
  const result = emptyResult();
  const seen = new Set<string>();
  // THE IMPORTANT ONE: a CPE corporation's installations share a mailbox, so the
  // email is the identity that must not be approached twice.
  const seenEmails = new Set<string>();

  const handle = (o: Record<string, string>): boolean => {
    if (result.candidates.length >= max) return false;
    result.scanned++;
    const row = toQcCpeRow(o);
    const key = qcCpeSourceKey(row);
    if (seen.has(key)) { reject(result, 'duplicate installation (same name and postal code)'); return true; }
    if (opts.isKnown?.(key)) { seen.add(key); reject(result, 'already known'); return true; }
    const ev = evaluateQcCpeRow(row);
    if (!ev.keep) { reject(result, ev.reason); return true; }
    const lead = toQcCpeLead(row, ev);
    if (lead.email) {
      if (seenEmails.has(lead.email)) { reject(result, 'shared mailbox with an installation already kept (same CPE corporation)'); return true; }
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
      await streamDelimitedRows({
        url: opts.urlOverride ?? QC_CPE_CSV_URL,
        delimiter: 'comma',
        requiredColumns: QC_CPE_REQUIRED,
        minRows: 500,
        timeoutMs: opts.timeoutMs ?? 180_000,
        log: opts.log,
        onRow: (o) => handle(o),
      });
    }
    opts.log?.(`qc cpe: scanned ${result.scanned}, candidates ${result.candidates.length}`);
  } catch (e) {
    result.errors.push(`qc cpe: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

export function allQcCpeLeads(opts: QcCpeOpts = {}): Promise<RegistryResult> {
  return findQcCpeCandidates(Number.MAX_SAFE_INTEGER, opts);
}

export { QC_LICENCE };
