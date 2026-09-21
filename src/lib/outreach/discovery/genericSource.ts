import { hostOf } from './findDomain';
import { politeFetchText } from './http';
import { cliComplete, extractJson } from '../llm';

// Shared search -> parse -> verify loop used by every Claude-web-search-based
// discovery source (agency search, job postings, review sites, GitHub signal).
// Each source supplies its own SourceSpec (prompt, query rotation, host
// exclusions, and how to verify a candidate's own site); this file owns the
// mechanics (JSON parsing, dedupe-by-domain, best-effort error handling).

export interface SearchCandidate {
  name: string;
  domain: string;
  location: string | null;
  blurb: string | null;
}

export interface SourceSpec {
  // Matches the calldesk_outreach_leads.signal_source check constraint
  // ('job_posting' | 'review_site' | 'directory' | 'search' | ...).
  signalSource: string;
  queriesForDay(now: Date, perDay: number): string[];
  promptFor(query: string): string;
  hostExclusions: string[];
  verify(domain: string): Promise<boolean>;
}

const DEFAULT_EXCLUDED_HOSTS = ['linkedin.com', 'facebook.com', 'youtube.com', 'reddit.com', 'yelp.com', 'wikipedia.org', 'google.com', 'twitter.com', 'x.com'];

function parseJsonArray(text: string): unknown[] {
  const parsed = extractJson<unknown[]>(text, 'array');
  return Array.isArray(parsed) ? parsed : [];
}

async function runQuery(spec: SourceSpec, query: string): Promise<unknown[]> {
  return parseJsonArray(cliComplete(spec.promptFor(query), { webSearch: true, maxTurns: 14, timeoutMs: 300_000 }));
}

export async function findCandidates(
  spec: SourceSpec,
  perDay: number,
  shouldStop: () => boolean = () => false,
): Promise<{ candidates: SearchCandidate[]; errors: string[]; raw: number; rejected: string[] }> {
  const errors: string[] = [];
  let raw = 0;
  const byDomain = new Map<string, SearchCandidate>();
  const excluded = [...DEFAULT_EXCLUDED_HOSTS, ...spec.hostExclusions];
  const queries = spec.queriesForDay(new Date(), perDay);

  for (const query of queries) {
    if (shouldStop()) break;
    try {
      const found = await runQuery(spec, query);
      raw += found.length;
      for (const entry of found) {
        const item = entry as { name?: unknown; website?: unknown; location?: unknown; blurb?: unknown };
        if (typeof item.name !== 'string' || typeof item.website !== 'string') continue;
        const domain = hostOf(item.website);
        if (!domain || excluded.some((h) => domain === h || domain.endsWith(`.${h}`))) continue;
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
    if (await spec.verify(candidate.domain)) verified.push(candidate);
    else rejected.push(candidate.domain);
  }
  return { candidates: verified, errors, raw, rejected };
}

// Shared default verify(): the candidate's homepage must load and read like
// a voice/AI business. Sources whose candidates aren't voice-AI companies
// themselves (e.g. review-site mentions, which ARE voice-AI companies too)
// can reuse this; sources looking for something else (media outlets, in the
// Kreative Koala pipeline) supply their own verify().
const LOOKS_LIKE_VOICE_AI = /(voice|phone|call|receptionist|answering|ai agent|conversational)/i;
export async function verifyLooksLikeVoiceAi(domain: string): Promise<boolean> {
  const res = await politeFetchText(`https://${domain}`, 12000);
  if (!res.ok || res.text.length < 500) return false;
  return LOOKS_LIKE_VOICE_AI.test(res.text.slice(0, 200_000));
}
