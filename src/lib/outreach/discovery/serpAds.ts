import { verifyLooksLikeVoiceAi, type SearchCandidate } from './genericSource';

// Google results for reseller-intent searches, INCLUDING the paid ads, through DataForSEO's SERP API.
// Claude's own web search cannot see ads; a company paying to show up for "white label AI receptionist" is
// exactly the kind of reseller or competitor we want in the pool. This only reads search results, then
// verifies each candidate's own homepage the same way the other sources do (genericSource.verifyLooksLikeVoiceAi).
//
// Cost: the live advanced endpoint costs $0.004 per search ($4 per 1,000). OUTREACH_SERP_QUERIES_PER_DAY defaults to 0 (off)
// and is capped at 20 a day in code (OUTREACH_SERP_MAX raises the cap for a deliberate bulk run). Credentials: DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD in the harness env.

export type SerpCandidate = SearchCandidate & { ad: boolean; query: string };

// English, US. Each is a search a reseller or a white-label vendor would pay to appear on.
const QUERIES = [
  // white-label and reseller intent
  'white label ai receptionist', 'white label ai voice agent', 'ai voice agent reseller program', 'resell ai phone agents',
  'ai call answering white label partner program', 'white label ai phone agent for agencies', 'ai receptionist reseller',
  'voice ai white label platform for agencies', 'ai voice agent partner program', 'become a voice ai reseller',
  // agencies that build on the big platforms
  'vapi agency', 'retell ai agency', 'synthflow agency', 'bland ai agency', 'voice ai agency', 'voice ai consultant',
  'gohighlevel voice ai', 'gohighlevel ai receptionist agency', 'ai voice agent development company', 'ai appointment setter agency',
  'n8n voice agent agency', 'elevenlabs voice agent agency', 'livekit voice agent developer', 'pipecat voice agent agency',
  // answering services and phone resellers adding AI
  'ai answering service for small business', 'ai phone answering service', 'virtual receptionist ai', 'ai receptionist for small business',
  'answering service ai voice agent', 'medical answering service ai', 'law firm answering service ai receptionist',
  'business phone system reseller ai receptionist', 'voip reseller ai voice agent',
  // vertical specialists (they sell to the same owners we do)
  'ai receptionist for dentists', 'ai receptionist for contractors', 'ai receptionist for law firms', 'ai voice agent for real estate',
  'ai voice agent for car dealerships', 'ai receptionist for home services', 'ai phone agent for restaurants', 'ai receptionist for medical practices',
];

const SLOT_MS = 2 * 60 * 60_000;
export function serpQueriesForDay(now = new Date(), perDay = 2): string[] {
  const slot = Math.floor(now.getTime() / SLOT_MS);
  return Array.from({ length: Math.min(perDay, QUERIES.length) }, (_, i) => QUERIES[(slot * perDay + i) % QUERIES.length]);
}

/** Daily cap on searches. 20 by default; OUTREACH_SERP_MAX raises it for a deliberate bulk run (each search is about $0.004). */
export function serpMax(): number {
  return Math.min(100, Math.max(1, Number(process.env.OUTREACH_SERP_MAX) || 20));
}

const EXCLUDED = [
  'retellai.com', 'vapi.ai', 'bland.ai', 'synthflow.ai', 'elevenlabs.io', 'poly.ai', 'openai.com', 'microsoft.com', 'amazon.com',
  'twilio.com', 'g2.com', 'capterra.com', 'clutch.co', 'linkedin.com', 'facebook.com', 'youtube.com', 'reddit.com', 'yelp.com',
  'wikipedia.org', 'google.com', 'x.com', 'twitter.com', 'trustpilot.com', 'forbes.com', 'zapier.com', 'medium.com', 'quora.com',
  'softwareadvice.com', 'getapp.com', 'sourceforge.net', 'producthunt.com', 'github.com', 'zoom.us', 'ringcentral.com',
];

function bare(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, '');
}

function nameFromTitle(title: string, domain: string): string {
  const t = title.split(/\s[|–—-]\s|:\s/)[0].trim();
  return (t.length >= 2 && t.length <= 60 ? t : domain.replace(/\.[a-z.]+$/, '')).slice(0, 120);
}

/** Pulls candidate companies out of one DataForSEO "organic/live/advanced" response. Pure, so it is unit tested. */
export function parseSerp(json: unknown, query: string, organicDepth = 10): SerpCandidate[] {
  const items: Array<Record<string, unknown>> =
    (json as { tasks?: Array<{ result?: Array<{ items?: Array<Record<string, unknown>> }> }> })?.tasks?.[0]?.result?.[0]?.items ?? [];
  const out = new Map<string, SerpCandidate>();
  let organicSeen = 0;
  for (const it of items) {
    const type = String(it.type ?? '');
    const isAd = type === 'paid';
    if (!isAd && type !== 'organic') continue;
    if (!isAd && ++organicSeen > organicDepth) continue;
    const domain = bare(String(it.domain ?? ''));
    if (!domain || EXCLUDED.some((h) => domain === h || domain.endsWith(`.${h}`))) continue;
    const prev = out.get(domain);
    if (prev && (prev.ad || !isAd)) continue; // keep the ad flag if either hit was an ad
    const title = String(it.title ?? '');
    const desc = String(it.description ?? '').replace(/\s+/g, ' ').trim();
    out.set(domain, {
      name: nameFromTitle(title, domain), domain, location: null,
      blurb: (isAd ? `Paid Google ad for "${query}". ` : `Ranks on Google for "${query}". `) + desc.slice(0, 180),
      ad: isAd || (prev?.ad ?? false), query,
    });
  }
  return [...out.values()];
}

export async function serpSearch(query: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error('DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set');
  const res = await fetchImpl('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ keyword: query, location_code: 2840, language_code: 'en', device: 'desktop', depth: 20 }]),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json()) as { status_code?: number; status_message?: string; tasks?: Array<{ status_code?: number; status_message?: string }> };
  const taskCode = json.tasks?.[0]?.status_code;
  if (!res.ok || json.status_code !== 20000 || (taskCode !== undefined && taskCode !== 20000)) {
    throw new Error(`DataForSEO ${json.status_code ?? res.status} ${json.tasks?.[0]?.status_message ?? json.status_message ?? ''}`.trim());
  }
  return json;
}

export async function findSerpCandidates(
  perDay: number,
  shouldStop: () => boolean = () => false,
): Promise<{ candidates: SerpCandidate[]; errors: string[]; raw: number; rejected: string[] }> {
  const errors: string[] = [];
  const found = new Map<string, SerpCandidate>();
  let raw = 0;
  for (const query of serpQueriesForDay(new Date(), Math.min(serpMax(), Math.max(0, perDay)))) {
    if (shouldStop()) break;
    try {
      const items = parseSerp(await serpSearch(query), query);
      raw += items.length;
      for (const c of items) { const prev = found.get(c.domain); if (!prev || (c.ad && !prev.ad)) found.set(c.domain, c); }
    } catch (error) {
      errors.push(`serp "${query}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const candidates: SerpCandidate[] = [];
  const rejected: string[] = [];
  for (const c of found.values()) {
    if (shouldStop()) break;
    if (await verifyLooksLikeVoiceAi(c.domain)) candidates.push(c); else rejected.push(c.domain);
  }
  return { candidates, errors, raw, rejected };
}
