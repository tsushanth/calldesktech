import { cleanEmail, isFreeMail } from './freightFmcsa';
import { DISCOVERY_UA } from './http';
import { JsonObjectSplitter } from './eeAriregister';
import {
  cityCountry, emptyResult, formatIntlPhone, reject, titleCase, type RegistryLead, type RegistryResult,
} from './registryCommon';
import { QC_ATTRIBUTION, QC_COUNTRY, QC_STATE } from './qcCommon';

// Home-services discovery from the QUÉBEC RBQ (Régie du bâtiment du Québec)
// register of ACTIVE construction licences, published on donneesquebec.ca under
// CC-BY 4.0 as one 87 MB JSON document.
//
// It is streamed and parsed incrementally with the same splitter the Estonian
// source uses — nothing is written to disk, and the document is never held whole.
//
// ============================================================================
// THE SUBCATEGORY MAP. This is the whole decision, so it is written out.
// ============================================================================
// The export publishes only subcategory CODES ("15.5", "16", "7", "GPC"), never
// their names, so the codes have to be mapped from the RBQ's own published list of
// specialised-contractor subclasses (rbq.gouv.qc.ca, "Sous-catégories
// d'entrepreneur spécialisé" / Annexe I). The codes below are the plumbing, heating,
// ventilation, refrigeration, electrical and roofing trades — the same phone-driven
// service businesses the US home-services sources and the French RGE source target:
//
//   15.1  Entrepreneur en systèmes de chauffage à air pulsé   (pulsed-air heating)
//   15.2  Entrepreneur en brûleurs au gaz naturel             (natural-gas burners)
//   15.3  Entrepreneur en brûleurs à l'huile                  (oil burners)
//   15.4  Entrepreneur en chauffage à l'eau chaude/vapeur     (hydronic heating)
//   15.5  Entrepreneur en plomberie                           (PLUMBING)
//   15.7  Entrepreneur en ventilation résidentielle           (residential ventilation)
//   15.8  Entrepreneur en ventilation                         (ventilation)
//   15.9  Entrepreneur en petits systèmes frigorifiques       (small refrigeration)
//   15.10 Entrepreneur en systèmes frigorifiques              (refrigeration / AC)
//   16    Entrepreneur en électricité                         (ELECTRICAL)
//   7     Entrepreneur en isolation, étanchéité, couvertures
//         et revêtements extérieurs                           (ROOFING, insulation, siding)
//
// EXPLICITLY NOT MAPPED, and therefore skipped: every general-contractor subclass
// (1.x–3.x), the civil-engineering and structural specialisations (4.x–6.x, 8.x–14.x),
// and the administrative codes the export mixes into the same array (GPC, SEC,
// AGC, and any other letter code), which are qualification markers rather than
// trades. If the RBQ renumbers its subclasses this map goes stale silently, so
// findQcRbqCandidates reports how many licences matched NOTHING — a sudden zero
// match rate is the signal that the map needs revisiting.
// ============================================================================
//
// ONE ROW PER LICENCE, but several subcategories inside it: the JSON nests
// `Catégories et sous-catégories` as an array, so a licence with three subclasses is
// one object, not three rows. The licence number is still deduped on, because the
// "Constructeur-propriétaire" and "Entrepreneur" licence types can share one holder.
//
// Only `Statut de la licence = "Active"` and `Type de licence = "Entrepreneur"` are
// kept: a "Constructeur-propriétaire" is an owner building for itself (a
// municipality, a housing corporation), not a contractor selling a service.
//
// COUNTRY AND LANGUAGE: Canadian leads, `country` CA, `location` "<City>, QC" so the
// draft is Canadian French. Held like every non-US lead, and additionally pending a
// CASL review.

export const QC_RBQ_JSON_URL = 'https://www.donneesquebec.ca/recherche/dataset/755b45d6-7aee-46df-a216-748a0191c79f/resource/5183fdd4-55b1-418c-8a7d-0a70058ed68d/download/rdl01_extractiondonneesouvertes.json';
export const QC_RBQ_DATASET_PAGE = 'https://www.donneesquebec.ca/recherche/dataset/755b45d6-7aee-46df-a216-748a0191c79f';
export const QC_RBQ_REGISTRY = 'Régie du bâtiment du Québec register of active construction licences (RBQ licences actives)';

// The wrapper key the licence array sits under in the published JSON.
export const QC_RBQ_ARRAY_KEY = '"Liste Licence"';

export const QC_RBQ_COLUMNS = {
  licence: 'Numéro de licence',
  status: 'Statut de la licence',
  type: 'Type de licence',
  email: 'Courriel',
  address: 'Adresse',
  neq: 'NEQ',
  name: "Nom de l'intervenant",
  phone: 'Numéro de téléphone',
  city: 'Municipalité',
  subcategories: 'Catégories et sous-catégories',
  subcategory: 'Sous-catégories',
  category: 'Categorie',
  otherName: 'Autre nom',
  legalStatus: 'Statut juridique',
  region: 'Région administrative',
} as const;

// code -> the English trade phrase the lead description states. See the header for
// why each one is here and what is deliberately absent.
export const QC_RBQ_TRADES: Record<string, string> = {
  '15.1': 'forced-air heating contractor',
  '15.2': 'natural-gas heating contractor',
  '15.3': 'oil-burner heating contractor',
  '15.4': 'hydronic heating contractor',
  '15.5': 'plumbing contractor',
  '15.7': 'residential ventilation contractor',
  '15.8': 'ventilation contractor',
  '15.9': 'refrigeration and air-conditioning contractor',
  '15.10': 'refrigeration and air-conditioning contractor',
  '16': 'electrical contractor',
  '7': 'roofing, insulation and exterior cladding contractor',
};

// A licence usually holds several of these; the most specific, most
// phone-driven trade wins the label.
const TRADE_PRIORITY = ['15.5', '16', '7', '15.10', '15.9', '15.8', '15.7', '15.4', '15.1', '15.2', '15.3'];

// Public bodies, the utilities and the large national contractors. The Québec
// counterpart of vaDporContractors.BIG_HOMESERVICES.
const BIG_QC = /\b(ville de|municipalit[ée] de|\bmrc\b|communaut[ée] m[ée]tropolitaine|gouvernement du|minist[èe]re|soci[ée]t[ée] (qu[ée]b[ée]coise|d'habitation)|hydro[- ]qu[ée]bec|[ée]nergir|gaz m[ée]tro|\bcisss\b|\bciusss\b|commission scolaire|centre de services scolaire|universit[ée]|\bsnc[- ]lavalin\b|\bwsp\b|\bstantec\b|\baecom\b|pomerleau|\bebc\b|\bepc\b inc|broccolini|magil|\bgdi\b|dessau|cima\b|englobe|black ?& ?mcdonald|\bcgi\b|bouygues|\bvinci\b|\bgroupe lefebvre\b|ainsworth|honeywell|johnson controls|siemens|schneider electric|carrier\b|trane\b|lennox|daikin|desjardins|\bbell canada\b|telus|videotron inc)\b/i;

export interface QcRbqRow {
  licence: string;
  status: string | null;
  type: string | null;
  email: string | null;
  address: string | null;
  neq: string | null;
  name: string;
  otherName: string | null;
  phone: string | null;
  city: string | null;
  region: string | null;
  legalStatus: string | null;
  subcategories: string[];
}

function str(x: unknown): string | null {
  const s = typeof x === 'string' ? x.trim() : x == null ? '' : String(x).trim();
  return s || null;
}

// The register writes the address as one line ending in the postal code:
// "415 RUE LINDSAY DRUMMONDVILLE QC CANADA J2B 1G8".
export function qcRbqPostcode(address: string | null): string | null {
  const m = /([A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d)\s*$/.exec((address ?? '').trim());
  return m ? m[1].toUpperCase() : null;
}

export function toQcRbqRow(o: Record<string, unknown>): QcRbqRow {
  const L = (o[QC_RBQ_COLUMNS.licence] != null ? o : (o.Licence ?? {})) as Record<string, unknown>;
  const subs = Array.isArray(L[QC_RBQ_COLUMNS.subcategories]) ? (L[QC_RBQ_COLUMNS.subcategories] as Record<string, unknown>[]) : [];
  return {
    licence: (str(L[QC_RBQ_COLUMNS.licence]) ?? '').replace(/\s+/g, ''),
    status: str(L[QC_RBQ_COLUMNS.status]),
    type: str(L[QC_RBQ_COLUMNS.type]),
    email: str(L[QC_RBQ_COLUMNS.email]),
    address: str(L[QC_RBQ_COLUMNS.address]),
    neq: str(L[QC_RBQ_COLUMNS.neq]),
    name: (str(L[QC_RBQ_COLUMNS.name]) ?? '').replace(/\s+/g, ' '),
    otherName: str(L[QC_RBQ_COLUMNS.otherName]),
    phone: str(L[QC_RBQ_COLUMNS.phone]),
    city: str(L[QC_RBQ_COLUMNS.city]),
    region: str(L[QC_RBQ_COLUMNS.region]),
    legalStatus: str(L[QC_RBQ_COLUMNS.legalStatus]),
    subcategories: [...new Set(subs.map((s) => str(s[QC_RBQ_COLUMNS.subcategory])).filter((s): s is string => !!s))],
  };
}

// The trade codes on this licence, in priority order. Empty means none of the
// subclasses is one of the trades this vertical is for.
export function qcRbqTrades(codes: string[]): string[] {
  const held = new Set(codes.map((c) => c.replace(/\s+/g, '')));
  return TRADE_PRIORITY.filter((c) => held.has(c) || (c === '16' && held.has('16.0')) || (c === '7' && held.has('7.0')));
}

export type Evaluation =
  | { keep: true; adjust: number; reasons: string[]; typeLabel: string; trades: string[] }
  | { keep: false; reason: string };

export function evaluateQcRbqRow(row: QcRbqRow): Evaluation {
  if (!row.name) return { keep: false, reason: 'no licence holder name' };
  if (!row.licence) return { keep: false, reason: 'no licence number' };
  if (row.status !== 'Active') return { keep: false, reason: `licence status is "${row.status ?? '?'}", not Active` };
  if (row.type !== 'Entrepreneur') return { keep: false, reason: `licence type is "${row.type ?? '?'}", not a contractor licence` };
  if (!row.city) return { keep: false, reason: 'no municipality' };
  if (!cleanEmail(row.email)) return { keep: false, reason: 'no usable email in the register' };
  if (BIG_QC.test(row.name)) return { keep: false, reason: 'public body, utility or large national contractor' };

  const trades = qcRbqTrades(row.subcategories);
  if (!trades.length) {
    return { keep: false, reason: 'subcategories are general, civil or administrative, not a plumbing/HVAC/electrical/roofing trade' };
  }
  const typeLabel = QC_RBQ_TRADES[trades[0]];

  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };

  add(3, `holds RBQ licence subcategory ${trades[0]} (${typeLabel})`);
  if (trades.length > 1) add(1, `also licensed for ${trades.slice(1).join(', ')}`);

  const email = cleanEmail(row.email);
  if (email && !isFreeMail(email)) add(5, 'business-domain email address published in the register');
  else if (email) add(-10, 'register email is a free-mail address, so it is not used as the contact');

  if (formatIntlPhone(row.phone)) add(2, 'publishes a phone number in the register');
  if (row.neq) add(2, 'registered with a Québec enterprise number (NEQ)');
  // "Personne physique" is a sole trader: its registered details are much closer to
  // personal data, exactly as for a French entreprise individuelle or a Norwegian ENK.
  if (/physique/i.test(row.legalStatus ?? '')) add(-12, 'SOLE TRADER (personne physique): its registered contact details may be personal data, and it is a one-person business');
  else if (/(compagnie|soci[ée]t[ée]|personne morale)/i.test(row.legalStatus ?? '')) add(3, 'registered as a company (personne morale)');

  return { keep: true, adjust, reasons, typeLabel, trades };
}

export function qcRbqSourceKey(licence: string): string {
  return `homeservices:qc:${licence.replace(/\s+/g, '')}`;
}

export function toQcRbqLead(row: QcRbqRow, ev: Extract<Evaluation, { keep: true }>): RegistryLead {
  // The register's "Autre nom" is the trade name and reads better than the legal one.
  const display = row.otherName ?? row.name;
  const name = titleCase(display);
  const location = cityCountry(row.city, QC_STATE);
  const phone = formatIntlPhone(row.phone);
  const email = cleanEmail(row.email);
  const usableEmail = email && !isFreeMail(email) ? email : null;
  let description = `Listed in the Régie du bâtiment du Québec register of active construction licences as a ${ev.typeLabel}`;
  if (location) description += `, based in ${location}`;
  return {
    sourceKey: qcRbqSourceKey(row.licence),
    name,
    legalName: row.name !== name ? row.name : null,
    city: row.city ? titleCase(row.city) : null,
    state: QC_STATE,
    phone,
    licenseId: row.licence,
    registryName: QC_RBQ_REGISTRY,
    typeLabel: ev.typeLabel,
    contactName: null,
    location,
    description: `${description}.`,
    signalDetail: `RBQ licence ${row.licence}, subcategories ${ev.trades.join('/')}${row.neq ? `, NEQ ${row.neq}` : ''}${row.region ? `, ${row.region}` : ''}; ${QC_ATTRIBUTION(QC_RBQ_REGISTRY)}${phone ? `; register phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: usableEmail,
    contactSourceUrl: usableEmail ? QC_RBQ_DATASET_PAGE : null,
    country: QC_COUNTRY,
  };
}

// ---- network ---------------------------------------------------------------

export interface QcRbqOpts {
  isKnown?: (sourceKey: string) => boolean;
  log?: (m: string) => void;
  timeoutMs?: number;
  // Test seam: the whole JSON document as text instead of the network.
  textOverride?: string;
  urlOverride?: string;
}

export async function findQcRbqCandidates(max: number, opts: QcRbqOpts = {}): Promise<RegistryResult> {
  const result = emptyResult();
  const seen = new Set<string>();
  const seenEmails = new Set<string>();
  // Tracked so a renumbered subclass map shows up as a collapsed match rate rather
  // than as a quietly empty import.
  let contractorLicences = 0;
  let tradeMatches = 0;

  const handle = (json: string): boolean => {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(json) as Record<string, unknown>;
    } catch {
      reject(result, 'unparseable record');
      return true;
    }
    // Only the licence wrapper objects matter; the nested subcategory objects are
    // consumed as part of their parent.
    const wrapped = o.Licence as Record<string, unknown> | undefined;
    if (!wrapped) return true;
    result.scanned++;
    const row = toQcRbqRow(o);
    if (row.status === 'Active' && row.type === 'Entrepreneur') {
      contractorLicences++;
      if (qcRbqTrades(row.subcategories).length) tradeMatches++;
    }
    const key = qcRbqSourceKey(row.licence);
    if (row.licence && seen.has(key)) { reject(result, 'duplicate licence number'); return true; }
    if (opts.isKnown?.(key)) { seen.add(key); reject(result, 'already known'); return true; }
    const ev = evaluateQcRbqRow(row);
    if (!ev.keep) { reject(result, ev.reason); return true; }
    const lead = toQcRbqLead(row, ev);
    if (lead.email) {
      if (seenEmails.has(lead.email)) { reject(result, 'shared mailbox with a licence already kept'); return true; }
      seenEmails.add(lead.email);
    }
    seen.add(key);
    result.candidates.push(lead);
    return result.candidates.length < max;
  };

  try {
    // The licences live in an array under one wrapper key, so the splitter is told
    // to skip past it — otherwise the only top-level object in the document is the
    // wrapper and nothing is ever emitted.
    const splitter = new JsonObjectSplitter(QC_RBQ_ARRAY_KEY);
    if (opts.textOverride != null) {
      for (const json of splitter.feed(opts.textOverride)) if (handle(json) === false) break;
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20 * 60_000);
      try {
        const url = opts.urlOverride ?? QC_RBQ_JSON_URL;
        opts.log?.(`qc rbq: streaming ${url}`);
        const res = await fetch(url, { headers: { 'User-Agent': DISCOVERY_UA, Accept: 'application/json' }, signal: controller.signal, redirect: 'follow' });
        if (!res.ok || !res.body) throw new Error(`${url} unavailable (HTTP ${res.status})`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let stop = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            for (const json of splitter.feed(decoder.decode(value, { stream: true }))) {
              if (handle(json) === false) { stop = true; break; }
            }
          }
          if (stop) { await reader.cancel().catch(() => {}); break; }
          if (result.scanned && result.scanned % 20_000 === 0) opts.log?.(`qc rbq: ${result.scanned} licences scanned, ${result.candidates.length} candidates`);
        }
      } finally {
        clearTimeout(timer);
      }
    }
    // THE STALE-MAP ALARM: if hardly any active contractor licence maps to a trade,
    // the RBQ has renumbered its subclasses and the map above is out of date.
    const rate = contractorLicences ? tradeMatches / contractorLicences : 0;
    if (contractorLicences > 1000 && rate < 0.05) {
      result.errors.push(`qc rbq: only ${tradeMatches} of ${contractorLicences} active contractor licences matched a trade subcategory (${(rate * 100).toFixed(1)}%); the RBQ subcategory codes in QC_RBQ_TRADES have probably been renumbered`);
    }
    opts.log?.(`qc rbq: scanned ${result.scanned}, active contractor licences ${contractorLicences}, trade matches ${tradeMatches}, candidates ${result.candidates.length}`);
  } catch (e) {
    result.errors.push(`qc rbq: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

export function allQcRbqLeads(opts: QcRbqOpts = {}): Promise<RegistryResult> {
  return findQcRbqCandidates(Number.MAX_SAFE_INTEGER, opts);
}
