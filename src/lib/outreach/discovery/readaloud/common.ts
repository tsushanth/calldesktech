// Shared plumbing for the readaloud (readaloudai.org) bulk lead sources in this
// directory: the lead shape every source produces, company/personal filters,
// and a polite HTTP client that honours robots.txt, spaces requests per host,
// backs off on 429/5xx and FAILS SOFT on blocks or bot challenges (it never
// retries past one, never rotates identity, never solves a challenge).
//
// Every source here yields ORGANISATIONS only. Individuals are filtered out at
// the parser level (personal free-mail, personal-looking names on personal
// domains, generic hosting like github.io / medium.com), and only what an
// organisation publishes about itself is kept.

import { DISCOVERY_UA, sleep } from '../http';
import { hostOf } from '../findDomain';
import { isFreeMail } from '../freightFmcsa';
import { compactName } from '../dedupe';

export { hostOf, isFreeMail, sleep };

export const RA_SOURCE_IDS = [
  'ra-cartesia-customers', 'ra-deepgram-customers', 'ra-yc-voice', 'ra-github-orgs',
  'ra-jobs-signal', 'ra-wp-plugins', 'ra-firefox-tts', 'ra-hn-launches',
] as const;
export type RaSourceId = (typeof RA_SOURCE_IDS)[number];

// The DB's signal_source check constraint allows only these values (migrations
// 029/030); no migration is needed for the new sources.
export type RaSignalSource = 'directory' | 'search' | 'job_posting' | 'tech_fingerprint';

// One source's facts about one company. Stored under
// signals.readaloud.sources[<sourceId>] so a re-run REPLACES rather than
// stacks it, and so several sources can describe the same company.
export interface RaSourceFacts {
  adjust: number;
  reasons: string[];
  facts: Record<string, unknown>;
}

export interface RaLead {
  sourceId: RaSourceId;
  sourceKey: string; // readaloud:<kind>:<id>, unique across the shared leads table
  name: string;
  domain: string; // the organisation's own website domain (required)
  location: string | null;
  // The company's OWN words (one-liner, plugin/add-on summary) or null. It reaches
  // the drafting prompt, so it must never carry third-party claims such as
  // "customer of Deepgram" (that goes in facts, which drafting never sees).
  description: string | null;
  signalSource: RaSignalSource;
  signalDetail: string;
  // A company-ROLE address published by the source itself (e.g. an add-on's
  // support_email at the company's own domain). Personal/free-mail never.
  email: string | null;
  emailSourceUrl: string | null;
  source: RaSourceFacts;
}

export interface RaLoadResult {
  leads: RaLead[];
  scanned: number;
  rejected: Record<string, number>;
  errors: string[];
  notes: string[];
}

export function emptyResult(): RaLoadResult {
  return { leads: [], scanned: 0, rejected: {}, errors: [], notes: [] };
}

export function reject(res: { rejected: Record<string, number> }, reason: string) {
  res.rejected[reason] = (res.rejected[reason] ?? 0) + 1;
}

// Hosts that are platforms, not an organisation's own site. A lead whose only
// website is one of these is dropped (a github.io page or a Medium blog is
// almost always an individual).
const GENERIC_HOSTS = [
  'github.com', 'github.io', 'gitlab.com', 'gitlab.io', 'bitbucket.org', 'medium.com', 'substack.com', 'notion.site', 'notion.so',
  'vercel.app', 'netlify.app', 'pages.dev', 'herokuapp.com', 'web.app', 'firebaseapp.com', 'glitch.me', 'replit.app', 'repl.co', 'fly.dev', 'onrender.com',
  'wordpress.com', 'wordpress.org', 'wp.com', 'blogspot.com', 'tumblr.com', 'wixsite.com', 'weebly.com', 'carrd.co', 'linktr.ee', 'bio.link',
  'gitbook.io', 'readthedocs.io', 'huggingface.co', 'hf.space', 'youtube.com', 'youtu.be', 'twitter.com', 'x.com', 'linkedin.com',
  'facebook.com', 'instagram.com', 'discord.gg', 'discord.com', 't.me', 'reddit.com', 'producthunt.com', 'ycombinator.com',
  'npmjs.com', 'pypi.org', 'crates.io', 'chrome.google.com', 'chromewebstore.google.com', 'addons.mozilla.org', 'apps.apple.com',
  'play.google.com', 'google.com', 'goo.gl', 'bit.ly', 'dev.to', 'hashnode.dev', 'itch.io', 'patreon.com', 'ko-fi.com', 'buymeacoffee.com',
  'sourceforge.net', 'codeberg.org', 'about.me', 'dropbox.com', 'drive.google.com', 'docs.google.com', 'apple.com', 'microsoft.com',
  'jobs.ashbyhq.com', 'ashbyhq.com', 'lever.co', 'greenhouse.io', 'workable.com', 'wellfound.com', 'angel.co', 'news.ycombinator.com',
];

// The speech-API vendors we price against, and ourselves: never leads.
const VENDOR_HOSTS = ['deepgram.com', 'cartesia.ai', 'elevenlabs.io', 'assemblyai.com', 'readaloudai.org', 'calldesk.tech'];

export function hostMatches(host: string, list: string[]): boolean {
  return list.some((h) => host === h || host.endsWith(`.${h}`));
}

export function isGenericHost(host: string): boolean {
  return hostMatches(host, GENERIC_HOSTS);
}

export function isVendorHost(host: string): boolean {
  return hostMatches(host, VENDOR_HOSTS);
}

// Organisation domain from a website URL (or bare domain). Drops the www,
// careers/jobs subdomains, and anything generic. null = not a company site.
export function orgDomain(urlOrHost: string | null | undefined): string | null {
  if (!urlOrHost) return null;
  let raw = String(urlOrHost).trim().replace(/&#x2F;/g, '/').replace(/&amp;/g, '&');
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let host = hostOf(raw);
  if (!host || !host.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  // Careers/docs/blog/app subdomains belong to the company's main domain.
  const bare = host.replace(/^(careers|jobs|join|apply|work|hiring|boards|docs|doc|blog|app|dashboard|console|beta|try|help|support|developers?|api|web|en)\./, '');
  if (bare.includes('.') && !/^(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(bare)) host = bare;
  if (isGenericHost(host)) return null;
  return host;
}

// "Jane Doe" / "Maria de la Cruz": a person's name rather than a company. Used
// only together with other evidence (e.g. the name also IS the domain), since
// plenty of companies are named after people.
const COMPANY_WORDS = /\b(inc|llc|ltd|gmbh|labs?|ai|software|tech|technologies|studio|studios|solutions|systems|media|digital|group|team|dev|apps?|io|voice|audio|speech|plugins?|co|company|corp|foundation|project|hq)\b/i;
export function looksLikePersonName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim();
  if (!n || COMPANY_WORDS.test(n)) return false;
  return /^[A-Z][a-z'’-]+(?: (?:[a-z]{1,3} )?[A-Z][a-z'’-]+){1,2}$/.test(n);
}

// A personal site: the name looks like a person AND the domain is that name
// (janedoe.com, jane-doe.dev).
export function isPersonalSite(name: string | null | undefined, domain: string): boolean {
  if (!looksLikePersonName(name)) return false;
  const label = domain.split('.')[0].replace(/[^a-z0-9]/g, '');
  const compact = compactName(name ?? '');
  return !!compact && (label === compact || label.includes(compact) || compact.includes(label));
}

// Role mailboxes: the only kind of source-published address we use directly.
const ROLE_LOCAL = /^(info|hello|hi|hey|contact|contactus|support|help|sales|team|partners?|partnerships|biz|business|bd|office|admin|dev|developers?|api|press|media|marketing|feedback|enquiries|inquiries|general|mail|care|service|customerservice|success|firefox|addons?|extensions?|plugins?|wordpress|wp)$/i;
export function companyRoleEmail(email: string | null | undefined, domain: string | null): string | null {
  const e = (email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return null;
  if (isFreeMail(e)) return null;
  const [local, host] = e.split('@');
  if (!ROLE_LOCAL.test(local)) return null;
  const hostOrg = orgDomain(host);
  if (!hostOrg) return null;
  // Must be the company's own domain (or its parent/child), not a stranger's.
  if (domain && !(hostOrg === domain || hostOrg.endsWith(`.${domain}`) || domain.endsWith(`.${hostOrg}`))) return null;
  return e;
}

// Display name from a domain when the source has no usable company name.
export function nameFromDomain(domain: string): string {
  const label = domain.split('.')[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x2F;/gi, '/').replace(/&#x27;|&#39;|&apos;/gi, "'").replace(/&quot;/g, '"')
    .replace(/&#8211;|&#8212;/g, '-').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function clip(s: string | null | undefined, n: number): string | null {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, n) : null;
}

// Country (last comma part) of the first location in "City, ST, Country; City2, ...".
export function countryOf(location: string | null | undefined): string | null {
  const first = (location ?? '').split(';')[0].trim();
  if (!first) return null;
  const parts = first.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

// ---------------------------------------------------------------------------
// robots.txt (RFC 9309, the subset that matters here): the `*` group (or a
// group naming our agent token), longest-match Allow/Disallow with `*` and `$`.
// 4xx robots => no restrictions; 5xx / network error => treat as disallowed.

export interface RobotsRules { allow: string[]; disallow: string[]; crawlDelayMs: number | null }

export function parseRobots(text: string, agentToken = 'calldesk-outreach-research'): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[]; delay: number | null }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], allow: [], disallow: [], delay: null }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'allow') { if (val) cur.allow.push(val); }
    else if (key === 'disallow') { if (val) cur.disallow.push(val); }
    else if (key === 'crawl-delay') { const n = Number(val); if (Number.isFinite(n)) cur.delay = n; }
  }
  const token = agentToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  const delay = chosen.map((g) => g.delay).find((d) => d != null) ?? null;
  return {
    allow: chosen.flatMap((g) => g.allow),
    disallow: chosen.flatMap((g) => g.disallow),
    crawlDelayMs: delay != null ? Math.min(delay, 30) * 1000 : null,
  };
}

function ruleRegex(rule: string): RegExp {
  const anchored = rule.endsWith('$');
  const body = (anchored ? rule.slice(0, -1) : rule).split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

export function robotsAllows(rules: RobotsRules, pathAndQuery: string): boolean {
  let best: { len: number; allow: boolean } | null = null;
  for (const [list, allow] of [[rules.allow, true], [rules.disallow, false]] as const) {
    for (const r of list) {
      if (ruleRegex(r).test(pathAndQuery) && (!best || r.length > best.len || (r.length === best.len && allow))) best = { len: r.length, allow };
    }
  }
  return best ? best.allow : true;
}

// ---------------------------------------------------------------------------
// Polite HTTP client. One instance per import run. Injected into every loader
// so parsers and loaders can be tested with a fake (no network in tests).

export interface HttpResponse { ok: boolean; status: number; text: string; headers: Record<string, string>; blocked?: string }

export interface RaHttp {
  get(url: string, opts?: { headers?: Record<string, string>; minDelayMs?: number; skipRobots?: boolean; accept?: string; maxBytes?: number }): Promise<HttpResponse>;
}

export class PoliteHttp implements RaHttp {
  private robots = new Map<string, RobotsRules | 'deny'>();
  private lastHit = new Map<string, number>();
  constructor(private defaults: { minDelayMs?: number; timeoutMs?: number; log?: (m: string) => void } = {}) {}

  private async raw(url: string, headers: Record<string, string>, maxBytes: number): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.defaults.timeoutMs ?? 30_000);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': DISCOVERY_UA, ...headers }, signal: controller.signal, redirect: 'follow' });
      const h: Record<string, string> = {};
      res.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
      const text = (await res.text()).slice(0, maxBytes);
      return { ok: res.ok, status: res.status, text, headers: h };
    } catch (e) {
      return { ok: false, status: 0, text: '', headers: {}, blocked: `network: ${e instanceof Error ? e.message : String(e)}` };
    } finally {
      clearTimeout(timer);
    }
  }

  private async rulesFor(origin: string): Promise<RobotsRules | 'deny'> {
    const cached = this.robots.get(origin);
    if (cached) return cached;
    const res = await this.raw(`${origin}/robots.txt`, { Accept: 'text/plain' }, 500_000);
    let rules: RobotsRules | 'deny';
    if (res.ok) rules = parseRobots(res.text);
    else if (res.status >= 400 && res.status < 500) rules = { allow: [], disallow: [], crawlDelayMs: null };
    else rules = 'deny';
    this.robots.set(origin, rules);
    return rules;
  }

  async get(url: string, opts: { headers?: Record<string, string>; minDelayMs?: number; skipRobots?: boolean; accept?: string; maxBytes?: number } = {}): Promise<HttpResponse> {
    let u: URL;
    try { u = new URL(url); } catch { return { ok: false, status: 0, text: '', headers: {}, blocked: 'bad url' }; }
    let delay = opts.minDelayMs ?? this.defaults.minDelayMs ?? 1000;
    if (!opts.skipRobots) {
      const rules = await this.rulesFor(u.origin);
      if (rules === 'deny') return { ok: false, status: 0, text: '', headers: {}, blocked: `robots.txt unavailable for ${u.host} (treated as disallow)` };
      if (!robotsAllows(rules, u.pathname + u.search)) return { ok: false, status: 0, text: '', headers: {}, blocked: `robots.txt disallows ${u.host}${u.pathname}` };
      if (rules.crawlDelayMs) delay = Math.max(delay, rules.crawlDelayMs);
    }
    const headers = { Accept: opts.accept ?? 'application/json, text/html;q=0.9, */*;q=0.5', ...(opts.headers ?? {}) };
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = (this.lastHit.get(u.host) ?? 0) + delay - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastHit.set(u.host, Date.now());
      const res = await this.raw(url, headers, opts.maxBytes ?? 20_000_000);
      const challenge = detectChallenge(res);
      if (challenge) return { ...res, ok: false, blocked: challenge };
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers['retry-after']);
        const backoff = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 120_000) : 5_000 * 2 ** attempt;
        this.defaults.log?.(`${u.host} ${res.status}; backing off ${Math.round(backoff / 1000)}s`);
        await sleep(backoff);
        continue;
      }
      return res;
    }
    return { ok: false, status: 429, text: '', headers: {}, blocked: `gave up on ${u.host} after repeated 429/5xx` };
  }
}

// A bot-protection interstitial is a stop sign, not something to retry or solve.
export function detectChallenge(res: HttpResponse): string | null {
  if (res.headers['cf-mitigated'] === 'challenge') return 'bot challenge (Cloudflare); not bypassed';
  if ((res.status === 403 || res.status === 503) && /cf-chl|challenge-platform|captcha|Just a moment\.\.\.|Attention Required/i.test(res.text.slice(0, 20_000))) {
    return `bot challenge (HTTP ${res.status}); not bypassed`;
  }
  return null;
}

export function parseJson<T>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { return null; }
}
