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

// US-focused reseller segments. Each is a kind of company that already sells phone or AI services to small
// businesses and could resell a voice platform or build on a speech API; none has its own discovery source, and
// most are English-language and US-based. The hint is added to the search prompt so the model knows what to
// look for (the default prompt only knows about 'AI voice agent agencies').
const US_SEGMENTS: { query: string; hint: string }[] = [
  { query: 'GoHighLevel agency AI voice agent white label for local businesses United States', hint: 'US agencies that resell AI voice agents or AI receptionists to local businesses on GoHighLevel (HighLevel) or similar white-label platforms' },
  { query: 'GoHighLevel AI receptionist agency for contractors and home services', hint: 'US agencies that resell AI voice agents or AI receptionists to local businesses on GoHighLevel (HighLevel) or similar white-label platforms' },
  { query: 'GoHighLevel voice AI setup agency for dentists and medical practices', hint: 'US agencies that resell AI voice agents or AI receptionists to local businesses on GoHighLevel (HighLevel) or similar white-label platforms' },
  { query: 'GoHighLevel AI agency white label SaaS reseller AI phone answering', hint: 'US agencies that resell AI voice agents or AI receptionists to local businesses on GoHighLevel (HighLevel) or similar white-label platforms' },
  { query: 'AI voice agent white label reseller agency United States', hint: 'US agencies that resell white-label AI voice agents to their own clients' },
  { query: 'answering service now offering AI call answering United States', hint: 'US answering services and call centers that sell phone answering to small businesses and have added, or are adding, AI call answering' },
  { query: 'medical answering service AI voice assistant after hours', hint: 'US answering services and call centers that sell phone answering to small businesses and have added, or are adding, AI call answering' },
  { query: 'legal answering service AI receptionist law firms', hint: 'US answering services and call centers that sell phone answering to small businesses and have added, or are adding, AI call answering' },
  { query: 'virtual receptionist company AI phone agent small business United States', hint: 'US virtual receptionist and answering companies that sell phone coverage by the minute or by the month and offer or are adding AI' },
  { query: 'managed service provider VoIP reseller AI voice agent for small business', hint: 'US managed service providers, VoIP and business-phone resellers that sell phone systems to small businesses and offer or are adding AI voice agents' },
  { query: 'business phone system reseller AI receptionist add-on United States', hint: 'US managed service providers, VoIP and business-phone resellers that sell phone systems to small businesses and offer or are adding AI voice agents' },
  { query: 'AI automation agency voice agents for small businesses United States', hint: 'US AI automation agencies that build voice agents or AI phone workflows for small-business clients' },
  { query: 'n8n Make Zapier AI automation agency voice agent clients United States', hint: 'US AI automation agencies that build voice agents or AI phone workflows for small-business clients' },
  { query: 'AI voice agent agency for car dealerships United States', hint: 'US agencies that build or resell AI voice agents for car dealerships' },
  { query: 'AI phone agent agency for property management and real estate United States', hint: 'US agencies that build or resell AI voice agents for real estate and property management' },
  { query: 'AI voice agent agency for restaurants and hospitality United States', hint: 'US agencies that build or resell AI voice agents for restaurants and hospitality' },
  { query: 'AI voice agent consultancy for healthcare practices United States', hint: 'US agencies that build or resell AI voice agents for healthcare practices' },
  { query: 'marketing agency adds AI voice agent service local businesses United States', hint: 'US digital-marketing agencies that have added AI voice agents or AI receptionists to what they sell local businesses' },
];
const HINT_BY_QUERY = new Map(US_SEGMENTS.map((x) => [x.query, x.hint]));

// Deterministic rotation, keyed by a time SLOT rather than calendar day, so
// running the harness several times a day advances through fresh vertical x
// phrasing combos each time instead of repeating the same day's set. The slot
// width should match (or be smaller than) the harness's run cadence.
const SLOT_MS = 2 * 60 * 60_000; // 2 hours
export function queriesForDay(now = new Date(), perDay = 3): string[] {
  const others = [
    ...VERTICALS.flatMap((v) => PHRASINGS.map((p) => `${p} ${v}`)),
    ...REGIONS.flatMap((r) => ['AI voice agent agency in', 'AI receptionist and phone agent company in'].map((p) => `${p} ${r}`)),
  ];
  // A US-segment query after every second of the rest, so the US segments get about a third of the budget and come
  // round every cycle instead of waiting behind all the regional queries.
  const combos: string[] = [];
  others.forEach((q, i) => { combos.push(q); if (i % 2 === 1) combos.push(US_SEGMENTS[(i >> 1) % US_SEGMENTS.length].query); });
  const slotNumber = Math.floor(now.getTime() / SLOT_MS);
  return Array.from({ length: perDay }, (_, i) => combos[(slotNumber * perDay + i) % combos.length]);
}

const PLATFORM_HOSTS = ['retellai.com', 'vapi.ai', 'bland.ai', 'synthflow.ai', 'elevenlabs.io', 'poly.ai', 'openai.com', 'microsoft.com', 'amazon.com', 'twilio.com', 'g2.com', 'capterra.com', 'clutch.co'];

const PROMPT = (query: string) => `Search the web for: ${query}

${HINT_BY_QUERY.has(query) ? `I want ${HINT_BY_QUERY.get(query)}. Small and mid-size companies only.` : 'I want small and mid-size agencies, studios or consultancies that BUILD or SELL AI voice agents / AI phone receptionists to other businesses.'} Exclude the voice-AI platforms themselves (Retell, Vapi, Bland, Synthflow, ElevenLabs, PolyAI), big enterprises, directories, and review or listicle sites.

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
