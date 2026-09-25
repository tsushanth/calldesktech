import { cleanEmail, isFreeMail } from './freightFmcsa';
import {
  cityCountry, emptyResult, formatIntlPhone, reject, titleCase, type RegistryLead, type RegistryResult,
} from './registryCommon';
import { listZipEntries, pickZipEntry, streamZipRows } from './zipStream';

// MEXICAN LEAD INGESTION from the INEGI DENUE — the "Directorio Estadístico
// Nacional de Unidades Económicas", the national statistical directory of
// economic units. INEGI publishes it as one zip PER STATE, free, no login and no
// API key (verified live 2026-09-24). Unlike most registers it publishes the
// establishment's own phone, email AND website, which is why it is worth a pass
// at all.
//
// EVERY lead from here is stored ON HOLD (region_blocked + signals.intlHold),
// because it is not a US lead — see registryCommon.INTL_HOLD_REASON. Nothing is
// drafted or sent until a human releases Mexico with release-country.ts, and the
// drafts are then written in Spanish (language.ts maps MX -> es).
//
// ---- the files -------------------------------------------------------------
// https://www.inegi.org.mx/contenidos/masiva/denue/denue_{01..32}_csv.zip, one per
// federal entity, 4-45 MB compressed — EXCEPT Estado de México (15), which is
// published as denue_15_1_csv.zip + denue_15_2_csv.zip (see DENUE_SPLIT_STATES).
// NOTE: the old denue_00_csv.zip (the whole country in one file) is stale and must
// not be used. A URL that no longer exists is served as HTTP 200 with a 2 KB HTML
// page, which zipStream.zipSize detects and names.
//
// Each archive holds THREE members and the one that matters is the second:
//   diccionario_de_datos/denue_diccionario_de_datos.csv   (the data dictionary)
//   conjunto_de_datos/denue_inegi_09_.csv                 <- the data
//   metadatos/metadatos_denue.txt
// The members are written with the data-descriptor flag set, so they have to be
// located through the central directory — see zipStream.ts. CDMX (state 09)
// inflates to 260 MB, which is why nothing here touches the disk.
//
// The data CSV is comma-separated, Latin-1, WITH a header row. Columns are
// resolved BY NAME rather than by position, because the directory has gained
// columns between releases and a silent off-by-one would put a phone number in
// the email field.
//
// Each state is its own WORK UNIT: 32 independent passes, so a run can do a
// couple of states and the next run can do the next couple.

export const DENUE_BASE = 'https://www.inegi.org.mx/contenidos/masiva/denue';
export const DENUE_REGISTRY = 'INEGI DENUE (Directorio Estadístico Nacional de Unidades Económicas)';
export const DENUE_SOURCE_URL = 'https://www.inegi.org.mx/app/mapa/denue/';
export const DENUE_MEMBER = /conjunto_de_datos\/.*\.csv$/i;

// The 32 federal entities, as INEGI's two-digit codes.
export const MX_STATE_CODES = Array.from({ length: 32 }, (_, i) => String(i + 1).padStart(2, '0'));

// STATES WHOSE ARCHIVE IS SPLIT. Estado de México (15) is the most populous
// state and INEGI publishes it as TWO files, denue_15_1_csv.zip (50 MB) and
// denue_15_2_csv.zip (30 MB); denue_15_csv.zip does not exist and is served as an
// HTML "Esta liga ya no existe" page with HTTP 200 (verified 2026-09-24). Every
// other state is a single denue_NN_csv.zip. Missing this would silently lose the
// largest state in the country, so the split is explicit here and a state's work
// unit is a LIST of parts.
export const DENUE_SPLIT_STATES: Record<string, number[]> = { '15': [1, 2] };

export function denueStateCode(state: string): string {
  const code = state.trim().padStart(2, '0');
  if (!MX_STATE_CODES.includes(code)) throw new Error(`"${state}" is not an INEGI state code (01..32)`);
  return code;
}

// Every archive that makes up one state, in order.
export function denueUrls(state: string): string[] {
  const code = denueStateCode(state);
  const parts = DENUE_SPLIT_STATES[code];
  if (!parts) return [`${DENUE_BASE}/denue_${code}_csv.zip`];
  return parts.map((p) => `${DENUE_BASE}/denue_${code}_${p}_csv.zip`);
}

// The first (or only) archive for a state.
export function denueUrl(state: string): string {
  return denueUrls(state)[0];
}

// ---- columns ---------------------------------------------------------------
// Resolved by name from the header row. These are the ones the source reads; the
// file has ~42 columns and the rest are address detail we do not use.
export const DENUE_REQUIRED_COLUMNS = ['nom_estab', 'raz_social', 'codigo_act', 'nombre_act', 'per_ocu', 'telefono', 'correoelec', 'www', 'municipio', 'entidad', 'cod_postal'] as const;

export interface DenueRow {
  nomEstab: string | null;
  razSocial: string | null;
  codigoAct: string;
  nombreAct: string | null;
  perOcu: string | null;
  telefono: string | null;
  correoelec: string | null;
  www: string | null;
  municipio: string | null;
  entidad: string | null;
  codPostal: string | null;
}

export function denueHeaderIndex(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  header.forEach((h, i) => { idx[h.trim().toLowerCase()] = i; });
  const missing = DENUE_REQUIRED_COLUMNS.filter((c) => !(c.toLowerCase() in idx));
  if (missing.length) throw new Error(`DENUE header is missing ${missing.join(', ')}; the file layout may have changed (header: ${header.join(',')})`);
  return idx;
}

const clean = (v: string | undefined): string | null => {
  const s = (v ?? '').trim();
  return s ? s : null;
};

export function toDenueRow(row: string[], idx: Record<string, number>): DenueRow {
  const at = (name: string) => row[idx[name]];
  return {
    nomEstab: clean(at('nom_estab')),
    razSocial: clean(at('raz_social')),
    codigoAct: (at('codigo_act') ?? '').trim(),
    nombreAct: clean(at('nombre_act')),
    perOcu: clean(at('per_ocu')),
    telefono: clean(at('telefono')),
    correoelec: clean(at('correoelec')),
    www: clean(at('www')),
    municipio: clean(at('municipio')),
    entidad: clean(at('entidad')),
    codPostal: clean(at('cod_postal')),
  };
}

// ---- SCIAN -> vertical -----------------------------------------------------
// SCIAN is the Mexican/North-American activity classification. Only codes whose
// email fill rate makes a pass worthwhile are mapped; the measured fill on CDMX
// (state 09) is quoted against each.
//
// Deliberately NOT included, because their email fill is 6-12% — a pass over
// them costs the same and yields almost nothing contactable:
//   812110 hairdressers/salons, 812310 funeral services, 467111 hardware retail.
export const MX_SCIAN_VERTICAL: Record<string, { product: string; typeLabel: string }> = {
  // "Servicios de contabilidad y auditoría" — 63% email fill
  '541211': { product: 'accounting', typeLabel: 'accounting and audit practice' },
  // "Inmobiliarias y corredores de bienes raíces" — 65%
  '531210': { product: 'realestate', typeLabel: 'real-estate agency' },
  // "Guarderías del sector privado" — 52%
  '624411': { product: 'childcare', typeLabel: 'private day nursery' },
  // "Servicios veterinarios para mascotas prestados por el sector privado" — 36%
  '541941': { product: 'vets', typeLabel: 'veterinary practice' },
  // "Consultorios dentales del sector privado" — 31%
  '621211': { product: 'dental', typeLabel: 'dental practice' },
};

export const MX_PRODUCT_IDS = [...new Set(Object.values(MX_SCIAN_VERTICAL).map((v) => v.product))].sort();

export function scianForProduct(product: string): string[] {
  return Object.keys(MX_SCIAN_VERTICAL).filter((c) => MX_SCIAN_VERTICAL[c].product === product);
}

// ---- filters ---------------------------------------------------------------

// DENUE publishes a headcount BAND rather than a number. The two largest bands
// are corporate sites and chains, not the owner-run practices the verticals are
// for, so they are dropped; everything up to 100 is kept.
export const BIG_HEADCOUNT_BANDS = [/101 a 250/i, /251 y m[áa]s/i];

export function isBigHeadcount(perOcu: string | null | undefined): boolean {
  const v = (perOcu ?? '').trim();
  return !!v && BIG_HEADCOUNT_BANDS.some((b) => b.test(v));
}

// Mexican free-mail providers on top of the global list: prodigy.net.mx and
// hotmail are as common as gmail on a small-business listing.
const MX_FREE_MAIL = /^(prodigy|yahoo|hotmail|live|outlook|att\.net\.mx|telmex|megared|infinitummail)\b/i;

export function isMxFreeMail(email: string | null | undefined): boolean {
  const e = (email ?? '').trim().toLowerCase();
  if (!e.includes('@')) return false;
  if (isFreeMail(e)) return true;
  return MX_FREE_MAIL.test(e.split('@')[1] ?? '');
}

// National chains, franchises and corporates that appear in these SCIAN codes.
const BIG_MX = /\b(kpmg|deloitte|pwc|pricewaterhouse|ernst ?& ?young|bdo|grant thornton|crowe|mazars|baker tilly|salles sainz|chevez|remax|re\/max|century ?21|coldwell banker|keller williams|sotheby'?s|vivanuncios|inmuebles24|grupo ?inmobiliario|dentalia|sonrisas? ?dental|smile ?center|mardent|petco|maskota|banfield|kids ?& ?us|liverpool|walmart|soriana|oxxo|femsa|bimbo|telcel|telmex|banorte|bbva|citibanamex|santander|hsbc|scotiabank)\b/i;

// A listing whose nom_estab is the generic activity description rather than a
// trade name. INEGI does this explicitly when a unit has no commercial name
// ("Cuando la unidad económica no tiene ningún apelativo comercial, entonces se
// registra con el nombre genérico de la actividad" — the data dictionary). Those
// rows cannot be addressed by name, so they are dropped unless a raz_social
// gives a real one.
export function isGenericName(nomEstab: string | null, nombreAct: string | null): boolean {
  const n = (nomEstab ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const a = (nombreAct ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return !!n && !!a && n === a;
}

export type MxEvaluation =
  | { keep: true; adjust: number; reasons: string[]; typeLabel: string; product: string; usableEmail: string | null; name: string }
  | { keep: false; reason: string };

export function evaluateDenueRow(r: DenueRow, product: string): MxEvaluation {
  const mapped = MX_SCIAN_VERTICAL[r.codigoAct];
  if (!mapped) return { keep: false, reason: 'SCIAN code is not one of the mapped verticals' };
  if (mapped.product !== product) return { keep: false, reason: `SCIAN code belongs to the ${mapped.product} vertical` };

  // Keeping only rows with an email is the whole point of this source: without
  // one a DENUE row adds nothing a search could not find.
  const email = cleanEmail(r.correoelec);
  if (!email) return { keep: false, reason: 'no email published' };
  if (isBigHeadcount(r.perOcu)) return { keep: false, reason: `headcount band "${r.perOcu}" is too large for the vertical` };

  // The trade name, else the legal name; a generic activity name counts as no name.
  const generic = isGenericName(r.nomEstab, r.nombreAct);
  const rawName = (!generic && r.nomEstab) || r.razSocial || null;
  if (!rawName) return { keep: false, reason: 'no trade name (INEGI recorded the generic activity description) and no raz_social' };
  if (BIG_MX.test(rawName) || (r.razSocial && BIG_MX.test(r.razSocial))) return { keep: false, reason: 'national chain, franchise or corporate name' };

  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };

  add(3, `listed in the INEGI DENUE under SCIAN ${r.codigoAct} (${mapped.typeLabel})`);

  // The free-mail rule, as in the merged sources: a free-mail address carries no
  // verifiable domain, so it is a scoring signal rather than the contact.
  // CHILDCARE is the documented exception (see childcareUs.ts) — a small
  // guardería genuinely runs on a hotmail address.
  const free = isMxFreeMail(email);
  const usableEmail = !free || product === 'childcare' ? email : null;
  if (!free) add(5, 'business-domain email address published in the directory');
  else if (product === 'childcare') add(-8, 'directory email is a free-mail address (kept: normal for a small guardería, but it carries no verifiable domain)');
  else add(-10, 'directory email is a free-mail address, so it is not used as the contact');

  if (r.www) add(3, 'publishes its own website in the directory');
  if (formatIntlPhone(r.telefono)) add(2, 'publishes a phone number in the directory');
  // The smallest bands are the owner-run practices the verticals convert best on.
  if (/^0 a 5|^6 a 10/i.test(r.perOcu ?? '')) add(2, `INEGI records a headcount of "${r.perOcu}"`);

  return { keep: true, adjust, reasons, typeLabel: mapped.typeLabel, product: mapped.product, usableEmail, name: rawName };
}

// A DENUE row has no licence number, so the lead is keyed on the CLEE — INEGI's
// own unique establishment identifier — which the caller passes through.
export function denueSourceKey(product: string, clee: string): string {
  return `${product}:mx:${clee}`;
}

// "www.foo.com.mx" / "http://foo.com.mx/inicio" -> "foo.com.mx"; null if it is
// not a usable host. The directory writes these inconsistently.
export function denueDomain(raw: string | null | undefined): string | null {
  let v = (raw ?? '').trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].trim();
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(v)) return null;
  // An email provider's host is not the business's own site.
  if (isMxFreeMail(`x@${v}`)) return null;
  return v;
}

export function toDenueLead(r: DenueRow, ev: Extract<MxEvaluation, { keep: true }>, clee: string): RegistryLead {
  const name = titleCase(ev.name);
  const city = r.municipio ? titleCase(r.municipio) : null;
  const location = cityCountry(city, 'MX');
  const phone = formatIntlPhone(r.telefono);
  let description = `Listed in the INEGI DENUE (Mexico's national directory of economic units) as a ${ev.typeLabel}`;
  if (location) description += `, based in ${location}`;
  return {
    sourceKey: denueSourceKey(ev.product, clee),
    name,
    legalName: r.razSocial && r.razSocial !== name ? r.razSocial : null,
    city,
    state: 'MX',
    phone,
    licenseId: clee,
    registryName: DENUE_REGISTRY,
    typeLabel: ev.typeLabel,
    contactName: null,
    location,
    description: `${description}.`,
    signalDetail: `DENUE CLEE ${clee}, SCIAN ${r.codigoAct}, ${r.entidad ?? '?'}${r.perOcu ? `, ${r.perOcu}` : ''}${phone ? `; directory phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: ev.usableEmail,
    contactSourceUrl: ev.usableEmail ? DENUE_SOURCE_URL : null,
    domain: denueDomain(r.www),
    country: 'MX',
  };
}

// ---- the source ------------------------------------------------------------

export interface MxDenueOpts {
  isKnown?: (sourceKey: string) => boolean;
  log?: (m: string) => void;
  // Which states to scan. Each is an independent work unit; defaults to all 32.
  states?: string[];
  maxRowsPerState?: number;
  maxCompressedBytes?: number;
  // Test seam: header + rows instead of streaming an archive.
  rowsOverride?: string[][];
}

export interface MxDenueResult extends RegistryResult {
  // Per-state row and candidate counts, so a partial run is auditable.
  byState: Record<string, { scanned: number; candidates: number }>;
}

// One pass over one state's archive for one vertical.
export async function findDenueCandidates(product: string, max: number, opts: MxDenueOpts = {}): Promise<MxDenueResult> {
  const log = opts.log ?? (() => {});
  const result: MxDenueResult = { ...emptyResult(), byState: {} };
  if (!MX_PRODUCT_IDS.includes(product)) {
    result.errors.push(`mx denue: no SCIAN mapping for the ${product} vertical`);
    return result;
  }
  const states = opts.states ?? MX_STATE_CODES;
  const seen = new Set<string>();

  const scanRows = (rows: Iterable<string[]>, state: string): void => {
    let idx: Record<string, number> | null = null;
    let cleeAt = -1;
    const stats = result.byState[state] ?? (result.byState[state] = { scanned: 0, candidates: 0 });
    for (const row of rows) {
      if (!idx) {
        idx = denueHeaderIndex(row);
        cleeAt = 'clee' in idx ? idx.clee : -1;
        continue;
      }
      result.scanned++;
      stats.scanned++;
      const r = toDenueRow(row, idx);
      const ev = evaluateDenueRow(r, product);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      // The CLEE is the directory's unique establishment key; the id column is a
      // fallback if a release ever drops it.
      const clee = (cleeAt >= 0 ? row[cleeAt] : row[0] ?? '').trim();
      if (!clee) { reject(result, 'no CLEE identifier'); continue; }
      if (seen.has(clee)) { reject(result, 'duplicate CLEE'); continue; }
      if (opts.isKnown?.(denueSourceKey(product, clee))) { reject(result, 'already known'); continue; }
      seen.add(clee);
      result.candidates.push(toDenueLead(r, ev, clee));
      stats.candidates++;
      if (result.candidates.length >= max) return;
    }
  };

  if (opts.rowsOverride) {
    scanRows(opts.rowsOverride, states[0] ?? '09');
    return result;
  }

  for (const state of states) {
    if (result.candidates.length >= max) break;
    const stats = result.byState[state] ?? (result.byState[state] = { scanned: 0, candidates: 0 });
    // A state is one or more archives (Estado de México is published as two), and
    // each part carries its own header row.
    for (const url of denueUrls(state)) {
      if (result.candidates.length >= max) break;
      try {
        const { entries } = await listZipEntries(url);
        const entry = pickZipEntry(entries, DENUE_MEMBER, url);
      let idx: Record<string, number> | null = null;
      let cleeAt = -1;
      await streamZipRows({
        url,
        entry,
        delimiter: ',',
        maxCompressedBytes: opts.maxCompressedBytes,
        onRow: (row) => {
          if (!idx) { idx = denueHeaderIndex(row); cleeAt = 'clee' in idx ? idx.clee : -1; return; }
          result.scanned++;
          stats.scanned++;
          const r = toDenueRow(row, idx);
          const ev = evaluateDenueRow(r, product);
          if (!ev.keep) { reject(result, ev.reason); return; }
          const clee = (cleeAt >= 0 ? row[cleeAt] : row[0] ?? '').trim();
          if (!clee) { reject(result, 'no CLEE identifier'); return; }
          if (seen.has(clee)) { reject(result, 'duplicate CLEE'); return; }
          if (opts.isKnown?.(denueSourceKey(product, clee))) { reject(result, 'already known'); return; }
          seen.add(clee);
          result.candidates.push(toDenueLead(r, ev, clee));
          stats.candidates++;
          if (result.candidates.length >= max) return false;
          if (opts.maxRowsPerState && stats.scanned >= opts.maxRowsPerState) return false;
        },
        log,
      });
      } catch (e) {
        result.errors.push(`mx denue ${product} ${url}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    log(`mx denue ${product}: state ${state} scanned ${stats.scanned}, candidates ${stats.candidates}`);
  }
  log(`mx denue ${product}: scanned ${result.scanned}, candidates ${result.candidates.length} across ${states.length} state(s)`);
  return result;
}

export function allDenueLeads(product: string, opts: MxDenueOpts = {}): Promise<MxDenueResult> {
  return findDenueCandidates(product, Number.MAX_SAFE_INTEGER, opts);
}
