import { promises as dns } from 'dns';
import { politeFetchText } from './http';
import { extractPageText, verifyBusinessPage, isAcceptableOwnSite, type BizIdentity, type Verdict, type PageText } from './websiteDiscovery';

// Quota-free website discovery: derive likely domains from a registry business name, keep only those that
// resolve in DNS, then run the SAME page check used to accept Claude's answers (name + city/state or phone
// must appear on the page). No LLM involved.

const SUFFIX = /\b(inc|llc|l\.l\.c|corp|corporation|co|company|ltd|incorporated|pllc|lp|llp|pc|dba)\b\.?/g;
const STOP = new Set(['and', 'of', 'the', 'a']);
const GENERIC = new Set(['services', 'service', 'contracting', 'contractors', 'contractor', 'construction', 'company', 'enterprises', 'enterprise', 'group', 'solutions', 'systems']);
const TRADE = ['hvac', 'electric', 'electrical', 'plumbing', 'roofing', 'heating', 'cooling', 'mechanical', 'air'];

function words(name: string): string[] {
  return name.toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').replace(SUFFIX, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
}

/** Ordered, de-duplicated candidate domains (most likely first), capped at `max`. */
export function candidateDomains(name: string, city: string | null, max = 40): string[] {
  const w = words(name);
  if (!w.length) return [];
  const noStop = w.filter((x) => !STOP.has(x));
  const core = noStop.filter((x) => !GENERIC.has(x));
  const j = (a: string[]) => a.join('');
  const bases: string[] = [];
  const add = (b: string) => { if (b && b.length >= 4 && !bases.includes(b)) bases.push(b); };
  add(j(w)); add(j(noStop)); add(j(core)); add(noStop.join('-')); add(core.join('-'));
  if (core.length >= 2) add(j(core.slice(0, 2)));
  if (w.length >= 2) add(j(w.slice(0, 2)));
  const trade = TRADE.find((t) => w.includes(t));
  const cty = (city ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const firstBases = bases.slice(0, 4);
  for (const b of firstBases) {
    for (const s of ['va', 'inc', 'llc', 'services', 'service', 'co', 'company', ...(trade ? [] : ['hvac', 'electric', 'plumbing', 'roofing']), ...(cty ? [cty] : [])]) add(b + s);
  }
  const out: string[] = [];
  for (const tld of ['com', 'net', 'org', 'us', 'biz', 'co']) {
    for (const b of bases) out.push(`${b}.${tld}`);
    if (tld === 'com' && out.length >= max) break;
  }
  return [...new Set(out)].slice(0, max);
}

async function resolves(domain: string, timeoutMs = 3000): Promise<boolean> {
  const t = new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs));
  const q = dns.resolve4(domain).then((a) => a.length > 0).catch(() => dns.resolveCname(domain).then((a) => a.length > 0).catch(() => false));
  return Promise.race([q, t]);
}

export interface GuessResult { domain: string | null; verdict: Verdict | null; tried: number; resolved: string[]; verified: string[] }

export async function guessWebsite(id: BizIdentity, opts: { max?: number; fetchPage?: (u: string) => Promise<{ ok: boolean; text: string }>; resolve?: (domain: string, timeoutMs?: number) => Promise<boolean> } = {}): Promise<GuessResult> {
  const resolveFn = opts.resolve ?? resolves;
  const cands = candidateDomains(id.name, id.city, opts.max ?? 40);
  const fetchPage = opts.fetchPage ?? ((u: string) => politeFetchText(u, 10000));
  // Resolve in small chunks with a retry: firing every candidate of many leads at once overwhelms the system
  // resolver and turns real domains into timeouts.
  const flags: boolean[] = [];
  for (let i = 0; i < cands.length; i += 10) {
    const chunk = await Promise.all(cands.slice(i, i + 10).map(async (c) => (await resolveFn(c, 4000)) || (await resolveFn(c, 8000))));
    flags.push(...chunk);
  }
  const resolved = cands.filter((_, i) => flags[i]);
  const verified: string[] = [];
  let first: { domain: string; verdict: Verdict } | null = null;
  for (const domain of resolved.slice(0, 6)) {
    if (!isAcceptableOwnSite(domain)) continue;
    const pages: PageText[] = [];
    let verdict: Verdict = { ok: false, name: false, phone: false, cityState: false, detail: 'no page loaded' };
    for (const path of ['/', '/contact', '/about']) {
      const res = await fetchPage(`https://${domain}${path}`);
      if (!res.ok || res.text.length < 300) continue;
      pages.push(extractPageText(res.text));
      verdict = verifyBusinessPage(pages, id);
      if (verdict.ok) break;
    }
    if (verdict.ok) { verified.push(domain); if (!first) first = { domain, verdict }; }
  }
  return { domain: first?.domain ?? null, verdict: first?.verdict ?? null, tried: cands.length, resolved, verified };
}
