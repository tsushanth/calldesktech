import { politeFetchText } from './http';
import { findCandidates, type SourceSpec, type SearchCandidate } from './genericSource';

// Finds agencies via public GitHub repos/docs that integrate a voice-AI SDK
// (Vapi, Retell, Bland) in a business context, not a hobby/tutorial project —
// verify() additionally checks the linked site reads as a business rather
// than a personal GitHub Pages README.

export type { SearchCandidate };

const QUERIES = [
  'GitHub agency repo integrating Vapi voice AI SDK for clients',
  'GitHub agency repo integrating Retell AI voice agent for clients',
  'GitHub organization voice AI phone agent client integrations',
];

// Slot (not day) keyed -- see searchSource.ts's queriesForDay for why.
const SLOT_MS = 2 * 60 * 60_000; // 2 hours
export function githubQueriesForDay(now = new Date(), perDay = 1): string[] {
  const slotNumber = Math.floor(now.getTime() / SLOT_MS);
  return Array.from({ length: perDay }, (_, i) => QUERIES[(slotNumber + i) % QUERIES.length]);
}

const PROMPT = (query: string) => `Search the web for: ${query}

I want to find small/mid-size AGENCIES or dev studios (not individual hobbyists, not the voice-AI platforms themselves) with a public GitHub presence (an org account, a repo, or docs) showing they integrate a voice-AI SDK (Vapi, Retell, Bland) for their OWN CLIENTS as a service, not a personal side project.

Return ONLY a JSON array (at most 10 items) of objects with keys: name (the agency/org), website (their own business homepage URL, from the search results — not the raw GitHub repo URL itself unless it's genuinely their homepage), location (if shown, else null), blurb (one factual sentence about the integration work, from what you saw). Only include ones you actually saw in the search results. Use at most 4 web searches, then answer immediately. No commentary, no markdown fences.`;

const EXCLUDED_HOSTS = ['github.com', 'github.io', 'retellai.com', 'vapi.ai', 'bland.ai', 'npmjs.com', 'pypi.org'];

// Extra check beyond the shared voice-AI-keyword test: the site must not look
// like a bare personal GitHub Pages README (no real business content).
const LOOKS_LIKE_BUSINESS = /(about us|our clients|services|contact|team|case stud)/i;
const LOOKS_LIKE_VOICE_AI = /(voice|phone|call|receptionist|answering|ai agent|conversational)/i;

async function verifyIsAgencySite(domain: string): Promise<boolean> {
  const res = await politeFetchText(`https://${domain}`, 12000);
  if (!res.ok || res.text.length < 500) return false;
  const text = res.text.slice(0, 200_000);
  return LOOKS_LIKE_VOICE_AI.test(text) && LOOKS_LIKE_BUSINESS.test(text);
}

const SPEC: SourceSpec = {
  signalSource: 'search', // no dedicated DB value for github; reuses the generic 'search' category
  queriesForDay: githubQueriesForDay,
  promptFor: PROMPT,
  hostExclusions: EXCLUDED_HOSTS,
  verify: verifyIsAgencySite,
};

export async function findGithubCandidates(perDay: number, shouldStop: () => boolean = () => false) {
  return findCandidates(SPEC, perDay, shouldStop);
}
