import { findCandidates, verifyLooksLikeVoiceAi, type SourceSpec, type SearchCandidate } from './genericSource';

// Finds agencies that build/sell AI voice agents on ANY platform by running a
// few rotating web searches per day through Claude's server-side web search.
// The model only proposes candidates; nothing it says is trusted until the
// candidate's own website is fetched and actually looks like a voice/AI
// business (guards against invented companies or URLs).
//
// This is now a thin SourceSpec over the shared loop in genericSource.ts;
// findSearchCandidates/queriesForDay keep their exact prior behavior and
// signatures so pipeline.ts's existing stageSearch needs no changes.

export type { SearchCandidate };

const VERTICALS = [
  'dental practices', 'real estate agents', 'home services (HVAC, plumbing, roofing)', 'law firms', 'medical clinics',
  'insurance agencies', 'restaurants', 'auto dealerships', 'property management companies', 'salons and spas',
  'chiropractors', 'veterinary clinics', 'contractors and trades', 'financial advisors', 'senior living and home care',
];
const PHRASINGS = ['AI voice agent agency for', 'AI receptionist company for', 'AI phone answering service built for'];
// Calldesk now supports 55 languages on real calls (STT+LLM+TTS+turn-taking
// verified) — this list was widened accordingly to actually go after
// international markets, not just the handful of English-speaking ones.
// Germany/Austria/Switzerland are deliberately excluded: score.ts blocks
// those regions from any outreach (prior-consent requirement), so searching
// for them would only waste query budget on leads that get filtered anyway.
const REGIONS = [
  // Europe
  'the United Kingdom', 'Ireland', 'the Netherlands', 'Belgium', 'France', 'Spain', 'Portugal', 'Italy', 'Poland',
  'Sweden and the Nordics', 'Norway', 'Denmark', 'Finland', 'Czech Republic', 'Romania', 'Hungary', 'Greece',
  // Americas
  'Canada', 'Mexico', 'Brazil', 'Colombia', 'Argentina', 'Chile', 'Peru', 'Central America', 'the Caribbean',
  // Middle East / Africa
  'the UAE and Middle East', 'Saudi Arabia', 'Israel', 'Turkey', 'South Africa', 'Nigeria', 'Kenya', 'Morocco', 'Egypt',
  // Asia-Pacific
  'India', 'Singapore and Southeast Asia', 'Indonesia', 'Vietnam', 'Thailand', 'the Philippines', 'Malaysia',
  'Japan', 'South Korea', 'Taiwan', 'Hong Kong', 'Australia and New Zealand', 'Pakistan', 'Bangladesh',
];

// Deterministic rotation, keyed by a time SLOT rather than calendar day, so
// running the harness several times a day advances through fresh vertical x
// phrasing combos each time instead of repeating the same day's set. The slot
// width should match (or be smaller than) the harness's run cadence.
const SLOT_MS = 2 * 60 * 60_000; // 2 hours
export function queriesForDay(now = new Date(), perDay = 3): string[] {
  const combos = [
    ...VERTICALS.flatMap((v) => PHRASINGS.map((p) => `${p} ${v}`)),
    ...REGIONS.flatMap((r) => ['AI voice agent agency in', 'AI receptionist and phone agent company in'].map((p) => `${p} ${r}`)),
  ];
  const slotNumber = Math.floor(now.getTime() / SLOT_MS);
  return Array.from({ length: perDay }, (_, i) => combos[(slotNumber * perDay + i) % combos.length]);
}

const PLATFORM_HOSTS = ['retellai.com', 'vapi.ai', 'bland.ai', 'synthflow.ai', 'elevenlabs.io', 'poly.ai', 'openai.com', 'microsoft.com', 'amazon.com', 'twilio.com', 'g2.com', 'capterra.com', 'clutch.co'];

const PROMPT = (query: string) => `Search the web for: ${query}

I want small and mid-size agencies, studios or consultancies that BUILD or SELL AI voice agents / AI phone receptionists to other businesses. Exclude the voice-AI platforms themselves (Retell, Vapi, Bland, Synthflow, ElevenLabs, PolyAI), big enterprises, directories, and review or listicle sites.

Return ONLY a JSON array (at most 12 items) of objects with keys: name, website (the company's own homepage URL, taken from the search results), location (city and country if shown, else null), blurb (one factual sentence from their own site). Only include companies you actually saw in the search results. Use at most 4 web searches, then answer immediately. No commentary, no markdown fences.`;

export async function verifyCandidateSite(domain: string): Promise<boolean> {
  return verifyLooksLikeVoiceAi(domain);
}

const SPEC: SourceSpec = {
  signalSource: 'search',
  queriesForDay,
  promptFor: PROMPT,
  hostExclusions: PLATFORM_HOSTS,
  verify: verifyLooksLikeVoiceAi,
};

export async function findSearchCandidates(
  queries: string[],
  shouldStop: () => boolean = () => false,
): Promise<{ candidates: SearchCandidate[]; errors: string[]; raw: number; rejected: string[] }> {
  // findCandidates recomputes its own queriesForDay(perDay) internally; the
  // caller-supplied `queries` list here is only used for its length, to
  // preserve the exact prior call shape pipeline.ts already uses.
  return findCandidates(SPEC, queries.length, shouldStop);
}
