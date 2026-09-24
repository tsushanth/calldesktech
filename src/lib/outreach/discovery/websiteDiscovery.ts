import * as cheerio from 'cheerio';
import { cliComplete, extractJson } from '../llm';
import { hostOf } from './findDomain';
import { politeFetchText, sleep } from './http';
import { compactName } from './dedupe';
import { DIRECTORY_HOSTS } from './verticalSearch';

// Registry lead -> own website. Registry sources (towing, septic, homecare) give
// a real business identity but no email, so we look the business up by name +
// city/state with the LLM's web search, then VERIFY the proposed site really is
// that business before anyone reads an email off it. The model only proposes a
// URL; the homepage (and /contact, /about) must itself show the business name AND
// either its registry phone or its city plus state. Same-named businesses in
// other cities therefore do not match. Never guesses a domain or an email.

export interface BizIdentity {
  name: string;
  legalName: string | null;
  city: string | null;
  state: string | null; // two-letter, e.g. "WA"
  phone: string | null; // formatted "(509) 455-8622" or null
}

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// Words that appear in many businesses' names of a trade; they do not identify one.
const GENERIC = new Set([
  'inc', 'llc', 'llp', 'ltd', 'co', 'corp', 'corporation', 'company', 'the', 'and', 'of', 'a', 'at', 'for', 'in', 'on',
  'service', 'services', 'home', 'care', 'health', 'homecare', 'healthcare', 'septic', 'tank', 'tanks', 'towing', 'tow', 'recovery',
  'wrecker', 'transport', 'transportation', 'systems', 'solutions', 'group', 'enterprises', 'pumping', 'pump', 'waste', 'sanitation',
  'agency', 'staffing', 'senior', 'seniors', 'plumbing', 'excavating', 'roadside', 'truck', 'trucking', 'operator', 'licensed', 'registered',
  'liquid', 'hauling', 'haulers', 'portables', 'drain', 'sewer', 'sewage', 'nursing', 'medical', 'assistance', 'associates', 'professional',
]);

export function distinctiveTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]s\b/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !GENERIC.has(t));
}

export interface PageText {
  identity: string; // title + h1/h2 + og:site_name + meta description (lowercased)
  body: string; // visible text + JSON-LD, whitespace-normalised (original case)
}

export function extractPageText(html: string): PageText {
  // Separate adjacent tags with a space so "<h1>Name</h1><p>City</p>" does not read "NameCity".
  const $ = cheerio.load(html.replace(/>\s*</g, '> <'));
  const ld = $('script[type="application/ld+json"]').map((_, e) => $(e).text()).get().join(' ');
  $('script, style, noscript, svg').remove();
  const identity = [
    $('title').text(), $('meta[property="og:site_name"]').attr('content') ?? '', $('meta[property="og:title"]').attr('content') ?? '',
    $('meta[name="description"]').attr('content') ?? '', $('h1').text(), $('h2').first().text(),
  ].join(' ').replace(/\s+/g, ' ').toLowerCase();
  const tel = $('a[href^="tel:"]').map((_, e) => $(e).attr('href') ?? '').get().join(' ');
  const body = `${$('body').text()} ${tel} ${ld}`.replace(/\s+/g, ' ');
  return { identity, body };
}

function wordRe(word: string): RegExp {
  return new RegExp(`(?<![a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i');
}

function phoneRe(phone: string): RegExp | null {
  const d = phone.replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return null;
  return new RegExp(`(?<!\\d)\\(?${d.slice(0, 3)}\\)?[\\s.\\-\\u2013/]*${d.slice(3, 6)}[\\s.\\-\\u2013]*${d.slice(6)}(?!\\d)`);
}

export interface Verdict { ok: boolean; name: boolean; phone: boolean; cityState: boolean; detail: string }

// Pure: does this page text belong to this registry business?
//   name  : EVERY distinctive token of the registry name (or its legal name) is
//           present on the page; a single-token name must sit in the title/h1/site
//           name, not merely somewhere in the body. A name that is all generic words
//           ("Home Care Inc") must match as a whole compact string.
//   place : the registry phone appears on the page, OR the city appears as a whole
//           word together with the state (2-letter abbreviation in caps, or full name).
//   ok    : name AND place.
export function verifyBusinessPage(pages: PageText[], id: BizIdentity): Verdict {
  const identity = pages.map((p) => p.identity).join(' ');
  const body = pages.map((p) => p.body).join(' ');
  const bodyLower = body.toLowerCase();
  const compactBody = compactName(bodyLower);

  let nameOk = false;
  for (const n of [id.name, id.legalName].filter((x): x is string => !!x)) {
    const toks = distinctiveTokens(n);
    if (!toks.length) {
      const c = compactName(n);
      if (c.length >= 8 && compactBody.includes(c)) nameOk = true;
      continue;
    }
    const all = toks.every((t) => wordRe(t).test(bodyLower) || wordRe(t).test(identity));
    if (!all) continue;
    if (toks.length === 1 && !wordRe(toks[0]).test(identity) && !compactBody.includes(compactName(n))) continue;
    nameOk = true;
  }

  const pr = id.phone ? phoneRe(id.phone) : null;
  const phoneOk = !!pr && pr.test(body);
  let csOk = false;
  if (id.city && id.state) {
    const cityOk = wordRe(id.city.toLowerCase()).test(bodyLower);
    const st = id.state.toUpperCase();
    const stateOk = new RegExp(`(?<![A-Za-z])${st}(?![A-Za-z])`).test(body) || (!!STATE_NAMES[st] && wordRe(STATE_NAMES[st].toLowerCase()).test(bodyLower));
    csOk = cityOk && stateOk;
  }
  const ok = nameOk && (phoneOk || csOk);
  return { ok, name: nameOk, phone: phoneOk, cityState: csOk, detail: `name=${nameOk} phone=${phoneOk} city+state=${csOk}` };
}

// Never accept these as "the business's own website".
const NOT_OWN_SITE = [
  ...DIRECTORY_HOSTS, 'facebook.com', 'linkedin.com', 'instagram.com', 'youtube.com', 'twitter.com', 'x.com', 'yelp.com', 'wikipedia.org', 'google.com',
  'tiktok.com', 'pinterest.com', 'reddit.com', 'mapquest.com', 'caring.com', 'seniorly.com', 'aplaceformom.com', 'medicare.gov', 'homehealthcarelist.com',
  'towbook.com', 'towing.com', 'bizapedia.com', 'opencorporates.com', 'dnb.com', 'zoominfo.com', 'chamberofcommerce.com', 'cylex.com', 'alignable.com',
  'localsearch.com', 'buzzfile.com', 'carefinder.com', 'seniorhomes.com',
];

export function isAcceptableOwnSite(domain: string | null): domain is string {
  if (!domain) return false;
  if (/\.(gov|mil|edu)$/.test(domain) || /\.(gov|state)\.[a-z]{2}$/.test(domain) || /(^|\.)state\.[a-z]{2}\.us$/.test(domain)) return false;
  return !NOT_OWN_SITE.some((h) => domain === h || domain.endsWith(`.${h}`));
}

export function searchPrompt(id: BizIdentity, kind: string): string {
  const where = [id.city, id.state].filter(Boolean).join(', ');
  return `Find the official website of this specific ${kind}: "${id.name}"${id.legalName ? ` (registered as "${id.legalName}")` : ''}, located in ${where || 'the United States'}${id.phone ? `, phone ${id.phone}` : ''}.

Return ONLY a JSON object {"website": "<the business's own homepage URL>"} or {"website": null}. The website must be the business's OWN site (not Facebook, Yelp, a directory, a government registry, or a lead-generation page) and it must be the business in that city, not a similarly named business elsewhere. If you are not confident it is this exact business, return {"website": null}. Use at most 3 web searches, then answer immediately. No commentary, no markdown fences.`;
}

export interface DiscoveryDeps {
  search: (prompt: string) => string;
  fetchPage: (url: string) => Promise<{ ok: boolean; text: string }>;
}

const realDeps: DiscoveryDeps = {
  search: (prompt) => cliComplete(prompt, { webSearch: true, maxTurns: 8, timeoutMs: 180_000 }),
  fetchPage: (url) => politeFetchText(url, 12000),
};

export type SiteResult =
  | { status: 'found'; domain: string; verdict: Verdict }
  | { status: 'none'; reason: string; domain?: string };

export async function discoverWebsite(id: BizIdentity, kind: string, deps: DiscoveryDeps = realDeps): Promise<SiteResult> {
  let raw: string;
  try {
    raw = deps.search(searchPrompt(id, kind));
  } catch (e) {
    return { status: 'none', reason: `search failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const parsed = extractJson<{ website?: unknown }>(raw, 'object');
  const site = typeof parsed?.website === 'string' ? parsed.website : null;
  if (!site) return { status: 'none', reason: 'model returned no website' };
  const domain = hostOf(site.startsWith('http') ? site : `https://${site}`);
  if (!isAcceptableOwnSite(domain)) return { status: 'none', reason: 'excluded host (directory/social/government)', domain: domain ?? undefined };

  const pages: PageText[] = [];
  let verdict: Verdict = { ok: false, name: false, phone: false, cityState: false, detail: 'no page loaded' };
  for (const path of ['/', '/contact', '/about']) {
    const res = await deps.fetchPage(`https://${domain}${path}`);
    if (path !== '/') await sleep(500);
    if (!res.ok || res.text.length < 300) continue;
    pages.push(extractPageText(res.text));
    verdict = verifyBusinessPage(pages, id);
    if (verdict.ok) return { status: 'found', domain, verdict };
  }
  return { status: 'none', reason: `site did not verify (${verdict.detail})`, domain };
}
