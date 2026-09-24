import { sleep as politeSleep } from './http';
import { socrataGet } from './socrata';

// Freight-broker discovery from FMCSA's free open data on data.transportation.gov
// (Socrata). No paid API, no scraping. Two datasets are joined on DOT number:
//
//   6eyk-hxee  "Carrier - All With History" (FMCSA operating-authority records).
//              broker_stat = 'A' means the entity currently holds ACTIVE property
//              BROKER authority (common_stat / contract_stat are the separate
//              carrier authorities). This is what separates brokers from
//              carriers; the census file below has no broker flag.
//   az4n-8mr2  "Company Census File" (MCS-150 registrations). Carries the
//              published business email_address, status_code, add_date, fleet
//              size. The authority dataset has no email.
//
// Both are public FMCSA registry data. Anonymous callers are rate limited
// ("Too many requests"), so every request is a small page, retried with
// exponential backoff, spaced apart, and the volume per run is deliberately low.
// An optional free SOCRATA_APP_TOKEN env var raises the limit but is not needed.

export const AUTHORITY_DATASET = '6eyk-hxee';
export const CENSUS_DATASET = 'az4n-8mr2';

export interface AuthorityRow {
  docket_number?: string;
  dot_number?: string;
  broker_stat?: string;
  broker_app_pend?: string;
  broker_rev_pend?: string;
  property_chk?: string;
  bond_file?: string;
  legal_name?: string;
  dba_name?: string;
  bus_city?: string;
  bus_state_code?: string;
  bus_ctry_code?: string;
  bus_telno?: string;
}

export interface CensusRow {
  dot_number?: string;
  legal_name?: string;
  dba_name?: string;
  email_address?: string;
  status_code?: string;
  add_date?: string;
  power_units?: string;
  total_drivers?: string;
  business_org_desc?: string;
  phy_city?: string;
  phy_state?: string;
}

export interface FreightBrokerCandidate {
  name: string;
  dba: string | null;
  mc: string;
  dot: string;
  city: string | null;
  state: string | null;
  email: string;
  phone: string | null;
  addDate: string | null;
  // Score adjustment (added to the product's vocabulary score) and reasons.
  adjust: number;
  reasons: string[];
}

export type Evaluation =
  | { keep: true; adjust: number; reasons: string[] }
  | { keep: false; reason: string };

// Enterprise / national brokers: not the 2-30 person shops we want to talk to.
// Matched against legal + dba name. A hit is a hard skip (these are well known;
// a false negative just means one big broker slips through and gets scored down
// by the vocabulary rules).
const BIG_BROKER = /\b(c\.?\s?h\.?\s?robinson|chrobinson|total quality logistics|tql|coyote logistics|xpo|rxo|echo global|landstar|j\.?\s?b\.?\s?hunt|jb hunt|uber freight|convoy|transplace|tran?splace|arrive logistics|globaltranz|worldwide express|schneider|werner|hub group|armada|allen lund|ryder|dhl|fedex|federal express|\bups\b|united parcel|amazon|nolan transportation|sunteck|mode transportation|redwood logistics|bnsf|expeditors|kuehne|db schenker|ceva|maersk|penske|forward air|radiant logistics|janel|stord|flexport|trinity logistics|gxo|americold|prologis|logistics plus|jb\s?hunt)\b/i;

const FREE_MAIL = /@(gmail|yahoo|hotmail|outlook|aol|icloud|live|msn|comcast|att|verizon|protonmail|proton|ymail|me|mail)\.(com|net|me)$/i;

// The same rule for the non-US registry sources. A free-mail address is never
// used as the lead's contact (registryLeadRow keeps no domain for one, and it
// scores down), and abroad the consumer ISP mailboxes are different: in France
// roughly a third of RGE contractors publish an orange.fr / wanadoo.fr / free.fr
// address, and in Norway an online.no / frisurf.no one. Without these they would
// be mistaken for business domains and their ISP treated as the company website.
// Kept as a second pattern so the US behaviour above is byte-for-byte unchanged.
//
// Deliberately narrow, in two parts, so that no name here can widen what counts
// as free-mail for a US .com lead:
//  * a mailbox name under a NON-US country TLD (orange.fr, online.no, ...) —
//    "free.fr" is an ISP, whereas "free.com" is somebody's business;
//  * a short list of FULL consumer-ISP domains that happen to sit on .com/.net.
const FREE_MAIL_INTL_CCTLD = new RegExp(
  '@(' + [
    // France
    'orange', 'wanadoo', 'free', 'sfr', 'neuf', 'laposte', 'bbox', 'aliceadsl', 'club-internet', 'numericable', 'gmx', 'yahoo', 'hotmail', 'live', 'outlook', 'msn', 'aol',
    // Norway
    'online', 'frisurf', 'broadpark', 'start', 'getmail', 'c2i', 'runbox', 'trollnett', 'hotmail', 'live',
    // United Kingdom
    'blueyonder', 'tiscali', 'talktalk', 'virginmedia', 'btinternet',
  ].join('|') + ')\\.(fr|no|co\\.uk|uk)$',
  'i',
);
const FREE_MAIL_INTL_EXACT = new Set([
  'googlemail.com', 'gmx.com', 'gmx.net',
  'btinternet.com', 'btconnect.com', 'btopenworld.com', 'virginmedia.com', 'ntlworld.com', 'talktalk.net', 'sky.com',
  'uol.com.br', 'bol.com.br', 'terra.com.br', 'globo.com', 'prodigy.net.mx',
]);

export function isFreeMail(email: string): boolean {
  const e = email.trim();
  if (FREE_MAIL.test(e) || FREE_MAIL_INTL_CCTLD.test(e)) return true;
  return FREE_MAIL_INTL_EXACT.has(e.split('@')[1]?.toLowerCase() ?? '');
}

export function isBigBroker(...names: (string | null | undefined)[]): boolean {
  return names.some((n) => !!n && BIG_BROKER.test(n));
}

const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export function cleanEmail(raw: string | undefined | null): string | null {
  const e = (raw ?? '').trim().toLowerCase();
  if (!e || e.length > 120 || !EMAIL_RE.test(e)) return null;
  return e;
}

export function stripZeros(dot: string | undefined | null): string {
  return (dot ?? '').trim().replace(/^0+/, '');
}

// MC-12345 style; docket_number in the authority dataset is "MC012892".
export function mcNumber(docket: string | undefined | null): string | null {
  const m = /^MC0*(\d{3,8})$/i.exec((docket ?? '').trim());
  return m ? m[1] : null;
}

const KEEP_UPPER = new Set(['LLC', 'INC', 'LLP', 'LP', 'USA', 'US', 'II', 'III', 'DBA', 'XPO']);
export function titleCase(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => {
      const bare = w.replace(/[^A-Za-z]/g, '').toUpperCase();
      if (KEEP_UPPER.has(bare)) return w.toUpperCase();
      // Already mixed-case (e.g. "McDonald") -> leave it.
      if (/[a-z]/.test(w) && /[A-Z]/.test(w)) return w;
      return w.toLowerCase().replace(/(^|[-'/(&])([a-z])/g, (_, p, c) => p + c.toUpperCase());
    })
    .join(' ');
}

// Pure filter + scoring for one authority row and its census row. All hard
// requirements are here so they can be unit tested without the network.
export function evaluateBroker(auth: AuthorityRow, census: CensusRow | undefined, now = new Date()): Evaluation {
  if (auth.broker_stat !== 'A') return { keep: false, reason: 'no active broker authority' };
  if (auth.broker_rev_pend === 'Y') return { keep: false, reason: 'broker authority revocation pending' };
  if (auth.bond_file === 'N') return { keep: false, reason: 'no broker bond on file' };
  if (auth.bus_ctry_code && auth.bus_ctry_code !== 'US') return { keep: false, reason: 'not a US business address' };
  if (!mcNumber(auth.docket_number)) return { keep: false, reason: 'no MC docket' };
  if (!census) return { keep: false, reason: 'no census record' };
  if (census.status_code && census.status_code !== 'A') return { keep: false, reason: 'census record inactive' };
  const email = cleanEmail(census.email_address);
  if (!email) return { keep: false, reason: 'no valid published email' };
  if (isBigBroker(auth.legal_name, auth.dba_name, census.legal_name, census.dba_name)) return { keep: false, reason: 'known large broker' };

  let adjust = 0;
  const reasons: string[] = [];
  const add = (delta: number, reason: string) => {
    adjust += delta;
    reasons.push(`${delta >= 0 ? '+' : ''}${delta}: ${reason}`);
  };

  if (isFreeMail(email)) add(-10, 'contact is a free-mail address (likely a very small or one-person shop, less reachable as a business)');
  else add(5, 'business-domain email address');

  const power = Number(census.power_units);
  const drivers = Number(census.total_drivers);
  if ((Number.isFinite(power) && power >= 50) || (Number.isFinite(drivers) && drivers >= 50)) {
    add(-15, 'registers a large fleet (not a small brokerage)');
  } else if (Number.isFinite(power) && power >= 1) {
    add(-5, 'also operates its own trucks (carrier-first; we want brokerages)');
  }

  const added = /^\d{8}$/.test(census.add_date ?? '')
    ? new Date(`${census.add_date!.slice(0, 4)}-${census.add_date!.slice(4, 6)}-${census.add_date!.slice(6, 8)}T00:00:00Z`)
    : null;
  if (added && now.getTime() - added.getTime() < 3 * 365 * 86_400_000) add(5, 'DOT registration added within the last 3 years');

  return { keep: true, adjust, reasons };
}

export function toCandidate(auth: AuthorityRow, census: CensusRow, ev: { adjust: number; reasons: string[] }): FreightBrokerCandidate {
  const dba = (auth.dba_name || census.dba_name || '').trim();
  const city = (auth.bus_city || census.phy_city || '').trim();
  const state = (auth.bus_state_code || census.phy_state || '').trim();
  return {
    name: titleCase(auth.legal_name || census.legal_name || ''),
    dba: dba && dba.toUpperCase() !== (auth.legal_name || '').toUpperCase() ? titleCase(dba) : null,
    mc: mcNumber(auth.docket_number) as string,
    dot: stripZeros(auth.dot_number),
    city: city ? titleCase(city) : null,
    state: state || null,
    email: cleanEmail(census.email_address) as string,
    phone: auth.bus_telno?.trim() || null,
    addDate: census.add_date ?? null,
    adjust: ev.adjust,
    reasons: ev.reasons,
  };
}

// Location string and factual, registry-only description used as the lead's
// `description`. It deliberately states nothing beyond what the FMCSA record shows.
export function describeBroker(c: FreightBrokerCandidate): { location: string | null; description: string } {
  const location = c.city && c.state ? `${c.city}, ${c.state}` : c.state;
  const parts = [`Listed in the FMCSA registry with active property broker authority (MC-${c.mc})`];
  if (location) parts[0] += `, based in ${location}`;
  if (c.dba) parts.push(`Also listed as doing business as ${c.dba}.`);
  return { location, description: parts[0] + '.' + (parts[1] ? ` ${parts[1]}` : '') };
}

// ---- network ---------------------------------------------------------------

const FMCSA_HOST = 'data.transportation.gov';
const socrata = <T,>(dataset: string, params: Record<string, string>, log: (m: string) => void) => socrataGet<T>(FMCSA_HOST, dataset, params, log);

const PAGE = Number(process.env.OUTREACH_FREIGHT_PAGE_SIZE) > 0 ? Math.min(300, Number(process.env.OUTREACH_FREIGHT_PAGE_SIZE)) : 150;
const SLOT_MS = 60 * 60_000;
const ACTIVE_BROKER_WHERE = "broker_stat='A' AND bus_ctry_code='US' AND docket_number like 'MC%'";

export interface FreightSourceResult {
  candidates: FreightBrokerCandidate[];
  scanned: number;
  rejected: Record<string, number>;
  errors: string[];
}

// Walks the active-broker list one page per call, at a slot-rotating offset so
// successive runs see different brokers (the pipeline dedupes by MC source_key,
// so revisiting a page is harmless). `offsetOverride` is for tests/dry runs.
export async function findFreightBrokerCandidates(
  maxCandidates: number,
  shouldStop: () => boolean = () => false,
  opts: { now?: Date; offsetOverride?: number; log?: (m: string) => void } = {},
): Promise<FreightSourceResult> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  const result: FreightSourceResult = { candidates: [], scanned: 0, rejected: {}, errors: [] };
  try {
    const cnt = await socrata<{ count: string }>(AUTHORITY_DATASET, { $select: 'count(*)', $where: ACTIVE_BROKER_WHERE }, log);
    const total = Number(cnt[0]?.count);
    if (!Number.isFinite(total) || total <= 0) throw new Error('could not read active broker count');
    const slot = Math.floor(now.getTime() / SLOT_MS);
    const offset = opts.offsetOverride ?? (slot * PAGE) % Math.max(1, total - PAGE);

    await politeSleep(500);
    const auth = await socrata<AuthorityRow>(AUTHORITY_DATASET, {
      $where: ACTIVE_BROKER_WHERE, $order: 'docket_number', $limit: String(PAGE), $offset: String(offset),
      $select: 'docket_number,dot_number,broker_stat,broker_app_pend,broker_rev_pend,property_chk,bond_file,legal_name,dba_name,bus_city,bus_state_code,bus_ctry_code,bus_telno',
    }, log);
    result.scanned = auth.length;

    const census = new Map<string, CensusRow>();
    const ids = [...new Set(auth.map((a) => stripZeros(a.dot_number)).filter(Boolean))];
    for (let i = 0; i < ids.length; i += 75) {
      if (shouldStop()) break;
      await politeSleep(500);
      const chunk = ids.slice(i, i + 75);
      const rows = await socrata<CensusRow>(CENSUS_DATASET, {
        $where: `dot_number in(${chunk.map((d) => `'${d.replace(/\D/g, '')}'`).join(',')}) AND email_address IS NOT NULL`,
        $select: 'dot_number,legal_name,dba_name,email_address,status_code,add_date,power_units,total_drivers,business_org_desc,phy_city,phy_state',
        $limit: '200',
      }, log);
      for (const r of rows) census.set(stripZeros(r.dot_number), r);
    }

    for (const a of auth) {
      if (result.candidates.length >= maxCandidates) break;
      const c = census.get(stripZeros(a.dot_number));
      const ev = evaluateBroker(a, c, now);
      if (!ev.keep) {
        result.rejected[ev.reason] = (result.rejected[ev.reason] ?? 0) + 1;
        continue;
      }
      result.candidates.push(toCandidate(a, c as CensusRow, ev));
    }
  } catch (e) {
    result.errors.push(`freight fmcsa: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
