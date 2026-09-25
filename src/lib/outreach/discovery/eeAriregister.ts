import { createInflateRaw } from 'node:zlib';
import { cleanEmail, isFreeMail } from './freightFmcsa';
import { DISCOVERY_UA } from './http';
import {
  cityCountry, emptyResult, formatIntlPhone, reject, titleCase, type RegistryLead, type RegistryResult,
} from './registryCommon';

// AGENCY / PARTNER discovery from the ESTONIAN business register (Äriregister),
// whose full open-data extract is published by the Centre of Registers and
// Information Systems (RIK) at avaandmed.ariregister.rik.ee.
//
// These are leads for the base product `calldesk` — the agency-partner pitch, the
// same audience the Retell directory supplies domestically — not for a vertical.
//
// ============================================================================
// THE FILE. 230 MB of ZIP that inflates to ~4.6 GB of pretty-printed JSON.
// ============================================================================
// It is NEVER written to disk and never held in memory as a whole. The pipeline is:
//   HTTP body -> skip the zip local file header -> inflateRaw -> incremental
//   top-level-object splitter -> JSON.parse one company -> keep or drop it.
// Local disk here has under 2 GB free, so saving it is not merely wasteful, it
// would fail. The walk is bounded by BYTE BUDGET, candidate count and a deadline,
// and stops by cancelling the response body, so a run never has to inflate all
// 4.6 GB to be useful. The array is ordered by company NAME, so a partial pass is
// an alphabetical slice — the `EE_DEFAULT_BYTE_BUDGET` comment says so plainly,
// because "we imported the As to the Ms" is a fact a reviewer needs to know.
//
// ZIP DETAILS (verified 2026-09-24). One entry,
// `ettevotja_rekvisiidid__yldandmed.json`, deflate-compressed (method 8), Zip64
// (the sizes in the local header are 0xFFFFFFFF and live in the extra field). The
// compressed data therefore starts at 30 + nameLength + extraLength, which
// parseZipLocalHeader computes rather than hardcoding.
//
// RECORD SHAPE (verified 2026-09-24):
//   nimi                                       company name
//   ariregistri_kood                           registry code (the lead key)
//   yldandmed.staatus                          "R" = on the register
//   yldandmed.oiguslik_vorm                    "OÜ" | "AS" | "FIE" | "MTÜ" | ...
//   yldandmed.teatatud_tegevusalad[].nace_kood EMTAK 2025, mapped to NACE
//   yldandmed.sidevahendid[] {liik, sisu}      EMAIL | MOB | TEL | WWW
//   yldandmed.aadressid[]                      address, ehak_nimetus, postiindeks
//   yldandmed.info_majandusaasta_aruannetest[].tootajate_arv
//                                              EMPLOYEE COUNT from the annual report
//
// Measured over the first 9,734 companies: 97.6% publish an email, and 9.1% carry
// one of the agency NACE codes below, of which 99.6% have an email.
//
// ONE-PERSON SHELLS. Estonia has a very large number of dormant OÜs registered for
// e-residency purposes; `tootajate_arv` from the latest annual report is the field
// that separates them from a real agency, and it is 0 for the overwhelming majority.
// A company with no filed report at all, or a latest report showing fewer than
// EE_MIN_EMPLOYEES, is dropped — that is the filter the brief asks for, and it is
// also the only quality signal this register offers.
//
// COUNTRY AND LANGUAGE: `country` is EE, so the international hold applies and
// `COUNTRY=EE tsx release-country.ts` releases them. English is the DELIBERATE draft
// language (language.ts lists EE as English with the reason spelled out: Estonian
// business email is routinely in English and nobody here can review Estonian).
//
// EVERY lead from here is stored ON HOLD (region_blocked + signals.intlHold).

export const EE_ZIP_URL = 'https://avaandmed.ariregister.rik.ee/sites/default/files/avaandmed/ettevotja_rekvisiidid__yldandmed.json.zip';
export const EE_REGISTRY = 'Estonian Business Register (Äriregister) open data, Centre of Registers and Information Systems (RIK)';
export const EE_SEARCH_URL = 'https://ariregister.rik.ee/eng/company/';

// EMTAK 2025 maps onto NACE, and the register publishes the NACE code directly.
export const EE_NACE: { code: string; label: string }[] = [
  { code: '62.10', label: 'software development agency' },
  { code: '62.20', label: 'IT consultancy' },
  { code: '63.10', label: 'data processing and hosting provider' },
  { code: '73.11', label: 'advertising agency' },
  { code: '70.22', label: 'business and management consultancy' },
  { code: '82.20', label: 'call centre operator' },
];

export const EE_NACE_CODES = new Set(EE_NACE.map((c) => c.code));

// OÜ (private limited) and AS (public limited) are companies. FIE is a sole trader
// — a natural person, so its registered contact details are much closer to personal
// data under GDPR — and MTÜ/SA are non-profits and foundations. TÜ/UÜ are
// partnerships and FIL a foreign branch; neither is the audience.
export const EE_KEEP_FORMS = new Set(['OÜ', 'AS']);

// The employee count the latest annual report must show. 2 rather than 1 because a
// single-employee OÜ in Estonia is overwhelmingly the owner's own invoicing vehicle.
export const EE_MIN_EMPLOYEES = 2;

// Large international consultancies, IT houses and outsourcers with an Estonian
// entity; the Estonian counterpart of BIG_NO_AGENCY in noBrregEnheter.ts.
const BIG_EE = /\b(accenture|capgemini|sopra ?steria|tietoevry|\btieto\b|nortal|helmes|proekspert|net ?group|icefire|wise\b|transferwise|bolt\b|playtech|pipedrive|skype|twilio|veriff|zego|glia\b|starship|swedbank|\bseb\b|luminor|coop pank|lhv\b|telia|elisa|tele2|deloitte|\bey\b|ernst (and|&) young|\bkpmg\b|\bpwc\b|pricewaterhouse|\bbdo\b|grant thornton|\brsm\b|mckinsey|boston consulting|dentsu|publicis|omnicom|havas\b|\bwpp\b|ogilvy|mccann|teleperformance|transcom|webhelp|foundever|concentrix|\bibm\b|microsoft|google|amazon|oracle|\bsap\b|salesforce|infosys|wipro|cognizant|\bepam\b|globant|thoughtworks|nagarro|fujitsu|atea\b|cgi\b|sysco\b)\b/i;

export interface EeRow {
  code: string; // ariregistri_kood
  name: string;
  status: string | null; // "R" on the register
  active: boolean;
  form: string | null;
  naceCodes: string[];
  primaryNace: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  postcode: string | null;
  address: string | null;
  employees: number | null;
  reportYearEnd: string | null;
}

// A string, or a number written as one. Anything else is null: String({}) is
// "[object Object]", and a register that puts an object where a name belongs would
// otherwise ship that as the company name (the RBQ source hit exactly this).
function str(x: unknown): string | null {
  if (typeof x === 'string') return x.trim() || null;
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);
  return null;
}

export function toEeRow(o: Record<string, unknown>): EeRow {
  const y = (o.yldandmed ?? {}) as Record<string, unknown>;
  const activities = Array.isArray(y.teatatud_tegevusalad) ? (y.teatatud_tegevusalad as Record<string, unknown>[]) : [];
  const contacts = Array.isArray(y.sidevahendid) ? (y.sidevahendid as Record<string, unknown>[]) : [];
  const addresses = Array.isArray(y.aadressid) ? (y.aadressid as Record<string, unknown>[]) : [];
  const reports = Array.isArray(y.info_majandusaasta_aruannetest) ? (y.info_majandusaasta_aruannetest as Record<string, unknown>[]) : [];

  const pick = (kind: string) => {
    // A contact row with a lopp_kpv ("end date") is a former one.
    const hit = contacts.find((c) => str(c.liik) === kind && !str(c.lopp_kpv));
    return hit ? str(hit.sisu) : null;
  };
  const addr = addresses.find((a) => !str(a.lopp_kpv)) ?? addresses[0] ?? {};
  // "Pirita linnaosa, Tallinn, Harju maakond" -> "Tallinn"; the city is the segment
  // ending in the county ("maakond") name's predecessor, so the second-to-last one.
  const ehak = str((addr as Record<string, unknown>).ehak_nimetus) ?? '';
  const parts = ehak.split(',').map((p) => p.trim()).filter(Boolean);
  const county = parts.findIndex((p) => /maakond$/i.test(p));
  const city = county > 0 ? parts[county - 1] : parts[0] ?? null;

  // The newest annual report, by the end of its reporting period.
  const latest = reports
    .slice()
    .sort((a, b) => eeDateKey(str(b.majandusaasta_perioodi_lopp_kpv)).localeCompare(eeDateKey(str(a.majandusaasta_perioodi_lopp_kpv))))[0];
  const headcount = latest ? Number((str(latest.tootajate_arv) ?? '').replace(/[^\d]/g, '')) : NaN;

  return {
    code: String(o.ariregistri_kood ?? '').replace(/\D/g, ''),
    name: (str(o.nimi) ?? '').replace(/\s+/g, ' '),
    status: str(y.staatus),
    // `tegutseb_tekstina` is "Jah"/"Ei" ("yes"/"no"); a null means not stated, which
    // is not evidence of being struck off, so only an explicit "Ei" counts.
    active: str(y.tegutseb_tekstina)?.toLowerCase() !== 'ei' && !str(y.kustutamise_kpv),
    form: str(y.oiguslik_vorm),
    naceCodes: [...new Set(activities.map((a) => str(a.nace_kood)).filter((c): c is string => !!c))],
    primaryNace: str(activities.find((a) => a.on_pohitegevusala === true)?.nace_kood) ?? str(activities[0]?.nace_kood),
    email: pick('EMAIL'),
    phone: pick('TEL') ?? pick('MOB'),
    website: pick('WWW'),
    city,
    postcode: str((addr as Record<string, unknown>).postiindeks),
    address: str((addr as Record<string, unknown>).tanav_maja_korter),
    employees: Number.isFinite(headcount) ? headcount : null,
    reportYearEnd: latest ? str(latest.majandusaasta_perioodi_lopp_kpv) : null,
  };
}

// The register writes dates as "dd.mm.yyyy"; turned into "yyyy-mm-dd" so they sort.
export function eeDateKey(raw: string | null): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((raw ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

export type Evaluation =
  | { keep: true; adjust: number; reasons: string[]; typeLabel: string; naceCode: string }
  | { keep: false; reason: string };

export function evaluateEeRow(row: EeRow): Evaluation {
  if (!row.name) return { keep: false, reason: 'no company name' };
  // The Estonian registry code is eight digits.
  if (row.code.length !== 8) return { keep: false, reason: 'no valid registry code' };
  if (row.status !== 'R') return { keep: false, reason: 'not on the register (struck off, in liquidation or in bankruptcy)' };
  if (!row.active) return { keep: false, reason: 'no longer trading' };
  if (!row.form || !EE_KEEP_FORMS.has(row.form)) {
    return { keep: false, reason: `legal form ${row.form ?? '?'} is not a company (sole trader, non-profit, foundation, partnership or foreign branch)` };
  }
  const matched = row.naceCodes.filter((c) => EE_NACE_CODES.has(c));
  if (!matched.length) return { keep: false, reason: 'no reported activity in an agency/consultancy NACE code' };
  const email = cleanEmail(row.email);
  if (!email) return { keep: false, reason: 'no usable email in the register' };
  if (BIG_EE.test(row.name)) return { keep: false, reason: 'large IT house, consultancy, outsourcer or well-known scale-up, not a small agency' };
  if (row.employees == null) return { keep: false, reason: 'no annual report on file, so its size cannot be established (likely a dormant shell)' };
  if (row.employees < EE_MIN_EMPLOYEES) {
    return { keep: false, reason: `latest annual report shows ${row.employees} employee(s), so it is a one-person invoicing vehicle rather than an agency` };
  }

  // The primary activity wins the label when it is one of ours, so a company whose
  // main business is advertising is not described as a software developer.
  const naceCode = row.primaryNace && EE_NACE_CODES.has(row.primaryNace) ? row.primaryNace : matched[0];
  const typeLabel = EE_NACE.find((c) => c.code === naceCode)?.label ?? 'IT consultancy';

  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };

  add(3, `reports activity under Estonian NACE code ${naceCode} (${typeLabel})`);
  if (row.form === 'AS') add(2, 'registered as an aktsiaselts (public limited company)');
  else add(2, 'registered as an osaühing (private limited company)');

  if (!isFreeMail(email)) add(5, 'business-domain email address published in the register');
  else add(-10, 'register email is a free-mail address, so it is not used as the contact');

  if (row.website) add(3, 'publishes its own website in the register');
  if (formatIntlPhone(row.phone)) add(2, 'publishes a phone number in the register');

  const n = row.employees;
  if (n >= 250) add(-15, `${n} employees (too large)`);
  else if (n >= 5) add(4, `${n} employees in its latest annual report (an established small agency)`);
  else add(2, `${n} employees in its latest annual report`);

  return { keep: true, adjust, reasons, typeLabel, naceCode };
}

export function eeSourceKey(code: string): string {
  return `calldesk:ee:${code.replace(/\D/g, '')}`;
}

// "https://www.example.ee/x" / "www.example.ee" -> "example.ee"; null if unusable.
export function eeDomain(raw: string | null): string | null {
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

export function toEeLead(row: EeRow, ev: Extract<Evaluation, { keep: true }>): RegistryLead {
  const name = titleCase(row.name);
  const location = cityCountry(row.city, 'EE');
  const phone = formatIntlPhone(row.phone);
  const email = cleanEmail(row.email);
  const usableEmail = email && !isFreeMail(email) ? email : null;
  let description = `Listed in the Estonian Business Register (Äriregister) as a ${ev.typeLabel}`;
  if (location) description += `, based in ${location}`;
  return {
    sourceKey: eeSourceKey(row.code),
    name,
    legalName: row.name !== name ? row.name : null,
    city: row.city ? titleCase(row.city) : null,
    state: 'EE',
    phone,
    licenseId: row.code,
    registryName: EE_REGISTRY,
    typeLabel: ev.typeLabel,
    contactName: null,
    location,
    description: `${description}.`,
    signalDetail: `Äriregister ${row.code} (${row.form ?? '?'}), NACE ${ev.naceCode}${row.employees != null ? `, ${row.employees} employees per the ${row.reportYearEnd ?? '?'} annual report` : ''}${phone ? `; register phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email: usableEmail,
    domain: eeDomain(row.website),
    contactSourceUrl: usableEmail ? `${EE_SEARCH_URL}${row.code}` : null,
    country: 'EE',
  };
}

// ---- the zip / JSON stream -------------------------------------------------

export interface ZipLocalHeader {
  dataOffset: number;
  method: number;
  name: string;
}

// Parses a ZIP local file header from the start of the archive and returns where
// the compressed data begins. Zip64 sizes live in the extra field and are not
// needed: the stream is read to the end of the deflate stream, not to a byte count.
export function parseZipLocalHeader(head: Uint8Array): ZipLocalHeader {
  if (head.length < 30) throw new Error('zip: not enough bytes for a local file header');
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const signature = view.getUint32(0, true);
  if (signature !== 0x04034b50) throw new Error(`zip: bad local file header signature 0x${signature.toString(16)}`);
  const method = view.getUint16(8, true);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const dataOffset = 30 + nameLength + extraLength;
  if (head.length < dataOffset) throw new Error('zip: local file header is longer than the bytes read');
  const name = new TextDecoder().decode(head.subarray(30, 30 + nameLength));
  if (method !== 8) throw new Error(`zip: entry "${name}" uses compression method ${method}, only deflate (8) is supported`);
  return { dataOffset, method, name };
}

// Splits a stream of JSON text into its TOP-LEVEL objects, one at a time, without
// ever holding more than the current object. Quote- and escape-aware, so a brace
// inside a string never confuses it. This is what makes a 4.6 GB array readable.
export class JsonObjectSplitter {
  // Optional marker to skip past before splitting starts. The Estonian file is a
  // top-level ARRAY of companies, so it needs none. The RBQ licence file wraps its
  // array in an object (`{"Liste Licence":[ ... ]}`), and without skipping past the
  // key the only "top-level object" in the whole document is the wrapper itself.
  private readonly startAfter: string | null;
  private waiting: boolean;
  private buf = '';
  // How much of `buf` has already been scanned. Essential: without it, a chunk
  // boundary that falls INSIDE an object makes the next feed re-scan the partial
  // object from the start and count its opening brace twice, so the depth never
  // returns to zero and not one object is ever emitted.
  private pos = 0;
  private depth = 0;
  private start = -1;
  private inString = false;
  private escaped = false;

  constructor(startAfter?: string) {
    this.startAfter = startAfter ?? null;
    this.waiting = !!startAfter;
  }

  feed(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    if (this.waiting) {
      const at = this.buf.indexOf(this.startAfter as string);
      if (at < 0) {
        // The marker can straddle a chunk boundary, so keep just enough of the tail
        // for it to be found next time.
        const keepFrom = Math.max(0, this.buf.length - (this.startAfter as string).length);
        this.buf = this.buf.slice(keepFrom);
        return out;
      }
      this.buf = this.buf.slice(at + (this.startAfter as string).length);
      this.waiting = false;
    }
    for (; this.pos < this.buf.length; this.pos++) {
      const ch = this.buf[this.pos];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (ch === '\\') this.escaped = true;
        else if (ch === '"') this.inString = false;
        continue;
      }
      if (ch === '"') { this.inString = true; continue; }
      if (ch === '{') {
        if (this.depth === 0) this.start = this.pos;
        this.depth++;
      } else if (ch === '}') {
        this.depth--;
        if (this.depth === 0 && this.start >= 0) {
          out.push(this.buf.slice(this.start, this.pos + 1));
          this.start = -1;
          // Everything up to here is finished with: drop it and rebase the cursor.
          this.buf = this.buf.slice(this.pos + 1);
          this.pos = -1; // the for-loop's ++ brings it back to 0
        }
      }
    }
    // Between objects there is nothing worth keeping (a comma and some
    // whitespace); mid-object, keep from the opening brace and rebase.
    if (this.depth === 0) { this.buf = ''; this.pos = 0; }
    else if (this.start > 0) { this.buf = this.buf.slice(this.start); this.pos -= this.start; this.start = 0; }
    return out;
  }
}

export interface EeOpts {
  isKnown?: (sourceKey: string) => boolean;
  log?: (m: string) => void;
  timeoutMs?: number;
  // How many DECOMPRESSED bytes to read before stopping. The array is ordered by
  // company name, so a budget makes the pass an ALPHABETICAL SLICE, not a random
  // sample: with the default the run covers roughly the first tenth of the
  // alphabet. Set Infinity for a genuinely full pass (~4.6 GB of transfer-free
  // inflation on top of a 230 MB download, which takes a long while).
  byteBudget?: number;
  deadlineMs?: number;
  // Test seam: whole JSON text instead of the network, already decompressed.
  textOverride?: string;
}

export const EE_DEFAULT_BYTE_BUDGET = 600 * 1024 * 1024; // ~1.3m of the 4.6 GB
export const EE_DEFAULT_DEADLINE_MS = 20 * 60_000;

export async function findEeAgencyCandidates(max: number, opts: EeOpts = {}): Promise<RegistryResult> {
  const result = emptyResult();
  const seen = new Set<string>();
  const seenDomains = new Set<string>();
  let bytes = 0;
  const deadline = Date.now() + (opts.deadlineMs ?? EE_DEFAULT_DEADLINE_MS);

  const handle = (json: string): boolean => {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(json) as Record<string, unknown>;
    } catch {
      reject(result, 'unparseable record');
      return true;
    }
    // Only top-level company objects carry `ariregistri_kood`.
    if (o.ariregistri_kood == null) return true;
    result.scanned++;
    const row = toEeRow(o);
    const key = eeSourceKey(row.code);
    if (seen.has(key)) { reject(result, 'duplicate registry code'); return true; }
    if (opts.isKnown?.(key)) { seen.add(key); reject(result, 'already known'); return true; }
    const ev = evaluateEeRow(row);
    if (!ev.keep) { reject(result, ev.reason); return true; }
    const lead = toEeLead(row, ev);
    // DEDUPE BY DOMAIN, as the brief asks: a group's companies share a website, and
    // the leads table allows one lead per (product, domain) anyway.
    const domain = lead.domain ?? (lead.email && !isFreeMail(lead.email) ? lead.email.split('@')[1] : null);
    if (domain) {
      if (seenDomains.has(domain)) { reject(result, 'duplicate domain (same group or shared website)'); return true; }
      seenDomains.add(domain);
    }
    seen.add(key);
    result.candidates.push(lead);
    return result.candidates.length < max;
  };

  try {
    const splitter = new JsonObjectSplitter();
    if (opts.textOverride != null) {
      for (const json of splitter.feed(opts.textOverride)) if (handle(json) === false) break;
    } else {
      await streamEeJson({
        timeoutMs: opts.timeoutMs,
        log: opts.log,
        onText: (text) => {
          bytes += text.length;
          for (const json of splitter.feed(text)) {
            if (handle(json) === false) return false;
          }
          if (bytes >= (opts.byteBudget ?? EE_DEFAULT_BYTE_BUDGET)) {
            result.errors.push(`ee agencies: stopped after ${Math.round(bytes / 1e6)} MB of decompressed JSON (${result.scanned} companies, alphabetically up to "${result.candidates.at(-1)?.name ?? '?'}"); raise byteBudget to go further`);
            return false;
          }
          if (Date.now() >= deadline) {
            result.errors.push(`ee agencies: ran out of time after ${result.scanned} companies; returning the ${result.candidates.length} candidates found so far`);
            return false;
          }
          return true;
        },
      });
    }
    opts.log?.(`ee agencies: scanned ${result.scanned}, candidates ${result.candidates.length}`);
  } catch (e) {
    result.errors.push(`ee agencies: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

export interface EeStreamOpts {
  url?: string;
  timeoutMs?: number;
  log?: (m: string) => void;
  // Return false to stop; the response body is then cancelled.
  onText: (text: string) => boolean;
}

// Downloads the zip, skips its local file header and inflates the single deflate
// entry, handing decoded text to `onText` chunk by chunk. Nothing is buffered
// beyond one chunk and nothing is written to disk.
export async function streamEeJson(opts: EeStreamOpts): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30 * 60_000);
  try {
    const url = opts.url ?? EE_ZIP_URL;
    const res = await fetch(url, { headers: { 'User-Agent': DISCOVERY_UA, Accept: 'application/zip,*/*' }, signal: controller.signal, redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`${url} unavailable (HTTP ${res.status})`);
    const reader = res.body.getReader();
    const inflate = createInflateRaw();
    const decoder = new TextDecoder('utf-8');
    let stopped = false;
    let failure: Error | null = null;

    inflate.on('data', (buf: Buffer) => {
      if (stopped) return;
      if (opts.onText(decoder.decode(buf, { stream: true })) === false) stopped = true;
    });
    inflate.on('error', (e: Error) => { failure = e; stopped = true; });

    // The header may be split across reads, so bytes are accumulated until the
    // declared header length is available.
    let head: Uint8Array = new Uint8Array(0);
    let headerDone = false;
    const write = (chunk: Uint8Array) => new Promise<void>((resolve, reject2) => {
      if (!inflate.write(chunk, (e) => (e ? reject2(e) : undefined))) inflate.once('drain', () => resolve());
      else resolve();
    });

    try {
      for (;;) {
        if (stopped) break;
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        if (!headerDone) {
          const merged = new Uint8Array(head.length + value.length);
          merged.set(head, 0);
          merged.set(value, head.length);
          head = merged;
          let parsed: ZipLocalHeader | null = null;
          try {
            parsed = parseZipLocalHeader(head);
          } catch (e) {
            // "not enough bytes" just means read more; anything else is fatal.
            if (!/not enough bytes|longer than the bytes read/.test(e instanceof Error ? e.message : '')) throw e;
          }
          if (!parsed) continue;
          opts.log?.(`ee agencies: inflating zip entry "${parsed.name}" from byte ${parsed.dataOffset}`);
          headerDone = true;
          await write(head.subarray(parsed.dataOffset));
          head = new Uint8Array(0);
          continue;
        }
        await write(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      await new Promise<void>((resolve) => inflate.end(() => resolve()));
    }
    if (failure) throw failure;
    if (!headerDone) throw new Error('ee agencies: the download ended before a complete zip local file header arrived');
  } finally {
    clearTimeout(timer);
  }
}

export function allEeAgencyLeads(opts: EeOpts = {}): Promise<RegistryResult> {
  return findEeAgencyCandidates(Number.MAX_SAFE_INTEGER, opts);
}
