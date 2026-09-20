import { getAnthropicClient } from '@/lib/anthropic';
import { hostOf } from './findDomain';
import { politeFetchText } from './http';
import { cliComplete, extractJson, usingCli } from '../llm';

// Finds agencies that build/sell AI voice agents on ANY platform by running a
// few rotating web searches per day through Claude's server-side web search.
// The model only proposes candidates; nothing it says is trusted until the
// candidate's own website is fetched and actually looks like a voice/AI
// business (guards against invented companies or URLs).

export interface SearchCandidate {
  name: string;
  domain: string;
  location: string | null;
  blurb: string | null;
}

const VERTICALS = [
  'dental practices', 'real estate agents', 'home services (HVAC, plumbing, roofing)', 'law firms', 'medical clinics',
  'insurance agencies', 'restaurants', 'auto dealerships', 'property management companies', 'salons and spas',
  'chiropractors', 'veterinary clinics', 'contractors and trades', 'financial advisors', 'senior living and home care',
];
const PHRASINGS = ['AI voice agent agency for', 'AI receptionist company for', 'AI phone answering service built for'];

// Deterministic rotation: each day advances through vertical x phrasing combos.
export function queriesForDay(now = new Date(), perDay = 3): string[] {
  const combos = VERTICALS.flatMap((v) => PHRASINGS.map((p) => `${p} ${v}`));
  const dayNumber = Math.floor(now.getTime() / 86_400_000);
  return Array.from({ length: perDay }, (_, i) => combos[(dayNumber * perDay + i) % combos.length]);
}

const PLATFORM_HOSTS = ['retellai.com', 'vapi.ai', 'bland.ai', 'synthflow.ai', 'elevenlabs.io', 'poly.ai', 'openai.com', 'google.com', 'microsoft.com', 'amazon.com', 'twilio.com', 'linkedin.com', 'facebook.com', 'youtube.com', 'reddit.com', 'g2.com', 'capterra.com', 'clutch.co', 'yelp.com', 'wikipedia.org'];

const PROMPT = (query: string) => `Search the web for: ${query}

I want small and mid-size agencies, studios or consultancies that BUILD or SELL AI voice agents / AI phone receptionists to other businesses. Exclude the voice-AI platforms themselves (Retell, Vapi, Bland, Synthflow, ElevenLabs, PolyAI), big enterprises, directories, and review or listicle sites.

Return ONLY a JSON array (at most 12 items) of objects with keys: name, website (the company's own homepage URL, taken from the search results), location (city and country if shown, else null), blurb (one factual sentence from their own site). Only include companies you actually saw in the search results. Use at most 4 web searches, then answer immediately. No commentary, no markdown fences.`;

function parseJsonArray(text: string): unknown[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function runQuery(query: string): Promise<unknown[]> {
  if (usingCli()) {
    return extractJson<unknown[]>(cliComplete(PROMPT(query), { webSearch: true, maxTurns: 14, timeoutMs: 300_000 }), 'array') ?? [];
  }
  const client = getAnthropicClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let messages: any[] = [{ role: 'user', content: PROMPT(query) }];

  for (let turn = 0; turn < 4; turn++) {
    const response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 4000,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }] as any,
      messages,
    });
    if (response.stop_reason === 'pause_turn') {
      messages = [...messages, { role: 'assistant', content: response.content }];
      continue;
    }
    let text = '';
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
    }
    return parseJsonArray(text);
  }
  return [];
}

const LOOKS_LIKE_VOICE_AI = /(voice|phone|call|receptionist|answering|ai agent|conversational)/i;

// Fetch the candidate's homepage; it must load and read like a voice/AI business.
export async function verifyCandidateSite(domain: string): Promise<boolean> {
  const res = await politeFetchText(`https://${domain}`, 12000);
  if (!res.ok || res.text.length < 500) return false;
  return LOOKS_LIKE_VOICE_AI.test(res.text.slice(0, 200_000));
}

export async function findSearchCandidates(
  queries: string[],
  shouldStop: () => boolean = () => false,
): Promise<{ candidates: SearchCandidate[]; errors: string[]; raw: number; rejected: string[] }> {
  const errors: string[] = [];
  let raw = 0;
  const byDomain = new Map<string, SearchCandidate>();

  for (const query of queries) {
    if (shouldStop()) break;
    try {
      const found = await runQuery(query);
      raw += found.length;
      for (const entry of found) {
        const item = entry as { name?: unknown; website?: unknown; location?: unknown; blurb?: unknown };
        if (typeof item.name !== 'string' || typeof item.website !== 'string') continue;
        const domain = hostOf(item.website);
        if (!domain || PLATFORM_HOSTS.some((h) => domain === h || domain.endsWith(`.${h}`))) continue;
        if (byDomain.has(domain)) continue;
        byDomain.set(domain, {
          name: item.name.trim().slice(0, 120),
          domain,
          location: typeof item.location === 'string' ? item.location.trim().slice(0, 120) : null,
          blurb: typeof item.blurb === 'string' ? item.blurb.trim().slice(0, 400) : null,
        });
      }
    } catch (error) {
      errors.push(`search "${query}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const verified: SearchCandidate[] = [];
  const rejected: string[] = [];
  for (const candidate of byDomain.values()) {
    if (shouldStop()) break;
    if (await verifyCandidateSite(candidate.domain)) verified.push(candidate);
    else rejected.push(candidate.domain);
  }
  return { candidates: verified, errors, raw, rejected };
}
