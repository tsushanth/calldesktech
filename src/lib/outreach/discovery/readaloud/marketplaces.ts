// ra-wp-plugins / ra-firefox-tts: publishers of text-to-speech plugins and
// browser add-ons with real usage (WordPress >=1000 active installs, Firefox
// >=5000 average daily users). The company is the publisher's own website
// (plugin homepage / author link / add-on homepage), never a wordpress.org or
// addons.mozilla.org profile page, and never an individual's personal site.
//
// ROBOTS NOTE (checked 2026-09-25): api.wordpress.org/robots.txt is
// "User-agent: * / Disallow: /". The plugins API is a documented public API,
// but this harness honours robots.txt literally, so ra-wp-plugins stops at the
// robots check and reports it instead of fetching. Parsers are complete and
// tested so the source works as-is if that policy decision is ever revisited.
// addons.mozilla.org allows /api/ in its robots.txt.

import { clip, companyRoleEmail, decodeEntities, emptyResult, isPersonalSite, isVendorHost, looksLikePersonName, nameFromDomain, orgDomain, parseJson, reject, stripTags, type RaHttp, type RaLead, type RaLoadResult } from './common';

export const TTS_TEXT = /text[- ]?to[- ]?speech|\btts\b|read(s|ing)? aloud|read(s)? (out|it) (loud|to you)|listen to (this|the|your) (article|post|content|page)|audio version|narrat(e|es|ion|or|ed)|speech synthesis|ai voices?|voice ?over|convert(s)? (your )?(text|content|posts?|articles?|blog posts?) (in)?to (audio|speech|podcasts?)|audio player for (your )?(posts|articles)|screen reader/i;

// ---- WordPress ----------------------------------------------------------------

export const WP_QUERIES = ['text to speech', 'listen to this article', 'read aloud', 'audio version', 'narrate'];
export const WP_MIN_INSTALLS = 1000;

export interface WpPlugin {
  name?: string; slug?: string; author?: string; author_profile?: string; homepage?: string; active_installs?: number;
  last_updated?: string; short_description?: string;
}

export function wpQueryUrl(search: string, page: number): string {
  const p = new URLSearchParams({
    action: 'query_plugins', 'request[search]': search, 'request[per_page]': '100', 'request[page]': String(page),
    'request[fields][description]': '0', 'request[fields][sections]': '0', 'request[fields][icons]': '0', 'request[fields][banners]': '0',
  });
  return `https://api.wordpress.org/plugins/info/1.2/?${p.toString()}`;
}

// last_updated looks like "2026-08-01 10:00am GMT"; only the date matters.
function yearsSince(dateish: string | undefined, now: Date): number | null {
  const d = /(\d{4}-\d{2}-\d{2})/.exec(dateish ?? '')?.[1];
  const t = d ? Date.parse(`${d}T00:00:00Z`) : NaN;
  return Number.isFinite(t) ? (now.getTime() - t) / (365.25 * 86_400_000) : null;
}

export function evaluateWpPlugin(p: WpPlugin, now = new Date()): RaLead | { reject: string } {
  const name = decodeEntities(p.name ?? '');
  const desc = decodeEntities(p.short_description ?? '');
  if ((p.active_installs ?? 0) < WP_MIN_INSTALLS) return { reject: 'under 1000 active installs' };
  if (!TTS_TEXT.test(`${name} ${desc}`)) return { reject: 'not a TTS plugin' };
  const authorHref = /href="([^"]+)"/.exec(p.author ?? '')?.[1];
  const domain = orgDomain(p.homepage) ?? orgDomain(authorHref);
  if (!domain) return { reject: 'no publisher website' };
  if (isVendorHost(domain)) return { reject: 'speech-API vendor itself' };
  const author = stripTags(p.author ?? '');
  if (isPersonalSite(author, domain)) return { reject: 'personal site' };
  const company = author && !looksLikePersonName(author) && author.length <= 60 ? author : nameFromDomain(domain);

  const installs = p.active_installs ?? 0;
  const reasons = ['+5: publishes a WordPress text-to-speech plugin'];
  let adjust = 5;
  if (installs >= 100_000) { adjust += 10; reasons.push(`+10: ${installs}+ active installs`); }
  else if (installs >= 10_000) { adjust += 5; reasons.push(`+5: ${installs}+ active installs`); }
  const age = yearsSince(p.last_updated, now);
  if (age != null && age > 2) { adjust -= 10; reasons.push(`-10: plugin not updated in ${Math.floor(age)} years`); }
  return {
    sourceId: 'ra-wp-plugins',
    sourceKey: `readaloud:wp-plugin:${p.slug}`,
    name: clip(company, 120) as string,
    domain,
    location: null,
    description: clip(`${name}: ${desc}`, 300),
    signalSource: 'directory',
    signalDetail: clip(`WordPress plugin "${name}" (${installs}+ installs)`, 280) as string,
    email: null,
    emailSourceUrl: null,
    source: { adjust, reasons, facts: { plugin: p.slug, installs, lastUpdated: p.last_updated ?? null, homepage: p.homepage ?? null } },
  };
}

export async function loadWpPlugins(http: RaHttp, opts: { maxPages?: number } = {}): Promise<RaLoadResult> {
  const res = emptyResult();
  const seen = new Set<string>();
  const all: WpPlugin[] = [];
  outer: for (const q of WP_QUERIES) {
    for (let page = 1; page <= (opts.maxPages ?? 4); page++) {
      const r = await http.get(wpQueryUrl(q, page), { minDelayMs: 1500 });
      if (!r.ok) { res.errors.push(`WordPress "${q}" p${page}: ${r.blocked ?? `HTTP ${r.status}`}`); if (r.blocked?.includes('robots')) break outer; break; }
      const j = parseJson<{ info?: { pages?: number }; plugins?: WpPlugin[] }>(r.text);
      for (const p of j?.plugins ?? []) { res.scanned++; if (p.slug && !seen.has(p.slug)) { seen.add(p.slug); all.push(p); } }
      if (page >= (j?.info?.pages ?? 1)) break;
    }
  }
  all.sort((a, b) => (b.active_installs ?? 0) - (a.active_installs ?? 0));
  for (const p of all) {
    const l = evaluateWpPlugin(p);
    if ('reject' in l) reject(res, l.reject); else res.leads.push(l);
  }
  return res;
}

// ---- Firefox add-ons -------------------------------------------------------------

export const FF_QUERIES = ['text to speech', 'read aloud', 'tts'];
export const FF_MIN_USERS = 5000;

type Localized = string | Record<string, string> | null | undefined;
export interface AmoAddon {
  slug?: string; name?: Localized; summary?: Localized; average_daily_users?: number;
  authors?: { name?: string; username?: string }[]; homepage?: { url?: Localized } | string | null; support_email?: Localized; support_url?: { url?: Localized } | null;
}

export function loc(v: Localized): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  return v['en-US'] ?? v['en-GB'] ?? Object.values(v)[0] ?? null;
}

export function evaluateAmoAddon(a: AmoAddon): RaLead | { reject: string } {
  const users = a.average_daily_users ?? 0;
  if (users < FF_MIN_USERS) return { reject: 'under 5000 daily users' };
  const name = decodeEntities(loc(a.name) ?? '');
  const summary = decodeEntities(loc(a.summary) ?? '');
  if (!TTS_TEXT.test(`${name} ${summary}`)) return { reject: 'not a TTS add-on' };
  const homepage = typeof a.homepage === 'string' ? a.homepage : loc(a.homepage?.url);
  const support = loc(a.support_email);
  const supportHost = support?.includes('@') ? support.split('@')[1] : null;
  // A free-mail support address says nothing about the company.
  const domain = orgDomain(homepage) ?? (support && companyRoleEmail(support, null) ? orgDomain(supportHost) : null) ?? orgDomain(loc(a.support_url?.url));
  if (!domain) return { reject: 'no publisher website' };
  if (isVendorHost(domain)) return { reject: 'speech-API vendor itself' };
  const author = a.authors?.[0]?.name ?? '';
  if (isPersonalSite(author, domain)) return { reject: 'personal site' };
  const company = author && !looksLikePersonName(author) && author.length <= 60 ? author : nameFromDomain(domain);
  const email = companyRoleEmail(support, domain);
  const reasons = ['+5: publishes a Firefox text-to-speech add-on'];
  let adjust = 5;
  if (users >= 50_000) { adjust += 10; reasons.push(`+10: ${users} daily users`); }
  else { adjust += 5; reasons.push(`+5: ${users} daily users`); }
  return {
    sourceId: 'ra-firefox-tts',
    sourceKey: `readaloud:firefox:${a.slug}`,
    name: clip(company, 120) as string,
    domain,
    location: null,
    description: clip(`${name}: ${summary}`, 300),
    signalSource: 'directory',
    signalDetail: clip(`Firefox add-on "${name}" (${users} daily users)`, 280) as string,
    email,
    emailSourceUrl: email ? `https://addons.mozilla.org/firefox/addon/${a.slug}/` : null,
    source: { adjust, reasons, facts: { addon: a.slug, dailyUsers: users } },
  };
}

export function amoSearchUrl(q: string, page: number): string {
  return `https://addons.mozilla.org/api/v5/addons/search/?${new URLSearchParams({ q, page_size: '50', page: String(page), app: 'firefox', sort: 'users', lang: 'en-US' }).toString()}`;
}

export async function loadFirefoxTts(http: RaHttp, opts: { maxPages?: number } = {}): Promise<RaLoadResult> {
  const res = emptyResult();
  const seen = new Set<string>();
  const all: AmoAddon[] = [];
  for (const q of FF_QUERIES) {
    for (let page = 1; page <= (opts.maxPages ?? 3); page++) {
      const r = await http.get(amoSearchUrl(q, page), { minDelayMs: 1000 });
      if (!r.ok) { res.errors.push(`AMO "${q}" p${page}: ${r.blocked ?? `HTTP ${r.status}`}`); break; }
      const j = parseJson<{ results?: AmoAddon[]; next?: string | null }>(r.text);
      const results = j?.results ?? [];
      for (const a of results) { res.scanned++; if (a.slug && !seen.has(a.slug)) { seen.add(a.slug); all.push(a); } }
      // Sorted by users: once a page ends below the threshold, later pages are too.
      if (!j?.next || (results.at(-1)?.average_daily_users ?? 0) < FF_MIN_USERS) break;
    }
  }
  all.sort((a, b) => (b.average_daily_users ?? 0) - (a.average_daily_users ?? 0));
  for (const a of all) {
    const l = evaluateAmoAddon(a);
    if ('reject' in l) reject(res, l.reject); else res.leads.push(l);
  }
  return res;
}
