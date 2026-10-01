// Sorts website visitors (as PostHog records them, one row per network address) into
// our own testing, automated traffic, unsubscribe-link opens, and likely humans.
// The rules are heuristics, so each result carries the reason it was given.

export type VisitorKind = 'internal' | 'automated' | 'unsubscribe' | 'human';

export interface VisitorRow {
  ip: string;
  country: string | null;
  city: string | null;
  os: string | null;
  device: string | null;
  browser: string | null;
  userAgent: string | null;
  referrer: string | null;
  pageviews: number;
  paths: string[];
  heroStarted: number;
  demoCalls: number;
  setupActions: number;
  email: string | null;
  firstSeen: string;
  lastSeen: string;
  firstPageview: string | null;
  lastPageview: string | null;
}

export interface ClassifiedVisitor extends VisitorRow {
  kind: VisitorKind;
  reason: string;
  /** A likely human who went beyond a single landing: 3+ pages, tried a demo, set something up, or signed in. */
  engaged: boolean;
}

export interface ClassifyConfig {
  /** Our own addresses: exact, or ending in * to cover a prefix (such as a home IPv6 network). */
  internalIps: string[];
  /** Addresses we treat as data-center or link-scanner traffic, in the same format. */
  botIps: string[];
  adminEmails: string[];
}

// Cloud and mail-security address ranges that showed up as "visitors" from our outreach emails
// and API docs. Microsoft Defender and similar tools open every link in a message; crawlers
// fetch the API description. Extend with ANALYTICS_BOT_IPS.
export const DEFAULT_BOT_IPS = [
  '135.232.', '74.179.', '172.186.', '4.204.', '72.145.', '72.153.', '72.152.', '20.', '40.', '52.',
  '34.', '35.', '104.197.', '104.196.', '54.', '3.', '2a03:2880:',
].map((p) => `${p}*`);

const BOT_UA = /bot|crawl|spider|facebookexternalhit|headless|playwright|puppeteer|lighthouse|preview|python-requests|curl\//i;
const BOT_PATH = /^\/(api\/|robots\.txt|sitemap|\.well-known)|openapi\.json/i;
const BURST_SECONDS = 5;

export function ipMatches(list: string[], ip: string): boolean {
  const addr = ip.trim().toLowerCase();
  if (!addr) return false;
  return list.some((entry) => {
    const e = entry.trim().toLowerCase();
    if (!e) return false;
    return e.endsWith('*') ? addr.startsWith(e.slice(0, -1)) : addr === e;
  });
}

export function parseList(value: string | undefined): string[] {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function seconds(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const d = Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 1000;
  return Number.isFinite(d) ? d : null;
}

export function classifyVisitor(v: VisitorRow, cfg: ClassifyConfig): ClassifiedVisitor {
  const demoActions = v.heroStarted + v.demoCalls + v.setupActions;
  const out = (kind: VisitorKind, reason: string): ClassifiedVisitor => ({
    ...v,
    kind,
    reason,
    engaged: kind === 'human' && (v.pageviews >= 3 || demoActions > 0 || !!v.email),
  });

  if (ipMatches(cfg.internalIps, v.ip)) return out('internal', 'Our own network');
  if (v.email && cfg.adminEmails.includes(v.email.toLowerCase())) return out('internal', 'Signed in as an admin');
  if (v.userAgent && /headlesschrome|playwright|puppeteer/i.test(v.userAgent)) return out('internal', 'Automated test browser');

  if (v.userAgent && BOT_UA.test(v.userAgent)) return out('automated', 'Crawler or bot user agent');
  if (v.paths.some((p) => BOT_PATH.test(p))) return out('automated', 'Fetched an API or crawler path');
  const span = seconds(v.firstPageview, v.lastPageview);
  if (v.pageviews >= 2 && span !== null && span <= BURST_SECONDS && demoActions === 0) {
    return out('automated', `${v.pageviews} pages within ${Math.round(span)}s (link scanner)`);
  }
  if (ipMatches([...DEFAULT_BOT_IPS, ...cfg.botIps], v.ip)) return out('automated', 'Data-center or mail-security network');

  if (v.paths.length > 0 && v.paths.every((p) => p.startsWith('/unsubscribe/'))) {
    return out('unsubscribe', 'Opened an unsubscribe link from an email');
  }
  return out('human', 'Looks like a person');
}

export interface VisitorSummary {
  total: number;
  internal: number;
  automated: number;
  unsubscribe: number;
  human: number;
  engaged: number;
  heroStarted: number;
  demoCalls: number;
}

export function summarize(rows: ClassifiedVisitor[]): VisitorSummary {
  const s: VisitorSummary = { total: rows.length, internal: 0, automated: 0, unsubscribe: 0, human: 0, engaged: 0, heroStarted: 0, demoCalls: 0 };
  for (const r of rows) {
    s[r.kind] += 1;
    if (r.engaged) s.engaged += 1;
    if (r.kind === 'human') {
      s.heroStarted += r.heroStarted > 0 ? 1 : 0;
      s.demoCalls += r.demoCalls > 0 ? 1 : 0;
    }
  }
  return s;
}
