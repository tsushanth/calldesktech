// ra-hn-launches: products launched on Hacker News (Show HN voice agents,
// "ElevenLabs alternative" stories) via the Algolia HN API. Only the DOMAIN of
// the story's own URL is kept (the product/company site); the submitter and
// commenters are never read or stored. Repos, blog posts on personal sites and
// generic hosts are dropped; low-traction launches score down as hobbyist.

import { clip, decodeEntities, emptyResult, isVendorHost, nameFromDomain, orgDomain, parseJson, reject, type RaHttp, type RaLead, type RaLoadResult } from './common';
import type { HnHit } from './jobsSignal';

export const HN_LAUNCH_QUERIES: { query: string; tags: string }[] = [
  { query: 'voice agent', tags: 'show_hn' },
  { query: 'text to speech', tags: 'show_hn' },
  { query: 'speech to text', tags: 'show_hn' },
  { query: 'voice ai', tags: 'show_hn' },
  { query: 'elevenlabs alternative', tags: 'story' },
];

// "Show HN: Acme – Voice agents for dentists" -> "Acme".
export function productNameFromTitle(title: string, domain: string): string {
  const t = decodeEntities(title).replace(/^(Show|Launch) HN:\s*/i, '').trim();
  const m = t.match(/^([^–—:|,(-]{2,40}?)\s*(?:[–—:|(]|\s-\s)/);
  const cand = m?.[1]?.trim();
  if (cand && !/^(I|We|My|Our|A|An|The|Open[- ]source|Free|Self-hosted|Local)\b/i.test(cand) && cand.split(/\s+/).length <= 4) return cand;
  return nameFromDomain(domain);
}

export function evaluateHnLaunch(h: HnHit, now = new Date()): RaLead | { reject: string } {
  if (!h.url) return { reject: 'no story url (text post)' };
  let path = '/';
  try { path = new URL(h.url).pathname; } catch { return { reject: 'bad url' }; }
  const domain = orgDomain(h.url);
  if (!domain) return { reject: 'repo / generic host' };
  if (isVendorHost(domain)) return { reject: 'speech-API vendor itself' };
  // A deep path that reads like an article is a blog post, not a product site.
  if (/\/(blog|posts?|articles?|p|writing|notes)\//i.test(path) || /\.(md|pdf|html?)$/i.test(path)) return { reject: 'blog post, not a product site' };
  const title = decodeEntities(h.title ?? '');
  const points = h.points ?? 0;
  const ageYears = h.created_at ? (now.getTime() - Date.parse(h.created_at)) / (365.25 * 86_400_000) : 0;
  if (ageYears > 3) return { reject: 'launch older than 3 years' };
  const reasons = ['+5: launched a voice/speech product on Hacker News'];
  let adjust = 5;
  if (points >= 50) { adjust += 5; reasons.push(`+5: ${points} points on HN`); }
  else if (points < 5) { adjust -= 10; reasons.push(`-10: low-traction launch (${points} points; hobbyist signal)`); }
  return {
    sourceId: 'ra-hn-launches',
    sourceKey: `readaloud:hn-launch:${domain}`,
    name: clip(productNameFromTitle(title, domain), 120) as string,
    domain,
    location: null,
    description: clip(title.replace(/^(Show|Launch) HN:\s*/i, ''), 300),
    signalSource: 'search',
    signalDetail: clip(`HN launch: ${title}`, 280) as string,
    email: null,
    emailSourceUrl: null,
    source: { adjust, reasons, facts: { hnItem: h.objectID, points, createdAt: h.created_at ?? null } },
  };
}

export async function loadHnLaunches(http: RaHttp, opts: { hitsPerQuery?: number } = {}): Promise<RaLoadResult> {
  const res = emptyResult();
  const byDomain = new Map<string, RaLead>();
  for (const { query, tags } of HN_LAUNCH_QUERIES) {
    const r = await http.get(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=${tags}&hitsPerPage=${opts.hitsPerQuery ?? 200}`, { minDelayMs: 1000 });
    if (!r.ok) { res.errors.push(`HN "${query}": ${r.blocked ?? `HTTP ${r.status}`}`); continue; }
    for (const h of parseJson<{ hits?: HnHit[] }>(r.text)?.hits ?? []) {
      res.scanned++;
      const l = evaluateHnLaunch(h);
      if ('reject' in l) { reject(res, l.reject); continue; }
      const cur = byDomain.get(l.domain);
      // Same product launched twice: keep the better-received launch.
      if (!cur || (l.source.facts.points as number) > (cur.source.facts.points as number)) byDomain.set(l.domain, l);
      else reject(res, 'duplicate domain');
    }
  }
  res.leads.push(...byDomain.values());
  return res;
}
