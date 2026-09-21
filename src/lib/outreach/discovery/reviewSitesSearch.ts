import { findCandidates, verifyLooksLikeVoiceAi, type SourceSpec, type SearchCandidate } from './genericSource';

// Finds agencies mentioned in public reviews on G2/Capterra/Clutch as voice-AI
// providers, via Claude web search (not scraping those sites directly).
//
// IMPORTANT: this source returns only a company NAME + the fact that they were
// reviewed as a voice-AI provider — never review text itself. The lead's
// `description`/`signal_detail` here is a generic label, not a quote. The
// drafted email (research.ts / agencyDraft.ts, unchanged) only ever cites a
// verified page on the LEAD'S OWN domain, never anything from the review site.

export type { SearchCandidate };

const QUERIES = [
  'G2 review AI voice agent agency for business',
  'Capterra review voice AI phone agent agency',
  'Clutch review AI receptionist agency for clients',
];

export function reviewSiteQueriesForDay(now = new Date(), perDay = 1): string[] {
  const dayNumber = Math.floor(now.getTime() / 86_400_000);
  return Array.from({ length: perDay }, (_, i) => QUERIES[(dayNumber + i) % QUERIES.length]);
}

const PROMPT = (query: string) => `Search the web for: ${query}

I want to find small/mid-size agencies (not the voice-AI platforms themselves) that appear in public reviews on sites like G2, Capterra, or Clutch as providers of AI voice agents / AI phone receptionists to their own clients.

Return ONLY a JSON array (at most 10 items) of objects with keys: name (the reviewed company), website (their own homepage URL, from the search results — never a G2/Capterra/Clutch URL), location (if shown, else null), blurb (a short, GENERIC factual label such as "reviewed on G2 as a voice AI agency" — do NOT copy or paraphrase any actual review text). Only include companies you actually saw in the search results. Use at most 4 web searches, then answer immediately. No commentary, no markdown fences.`;

const EXCLUDED_HOSTS = ['g2.com', 'capterra.com', 'clutch.co', 'trustpilot.com', 'retellai.com', 'vapi.ai', 'bland.ai'];

const SPEC: SourceSpec = {
  signalSource: 'review_site',
  queriesForDay: reviewSiteQueriesForDay,
  promptFor: PROMPT,
  hostExclusions: EXCLUDED_HOSTS,
  verify: verifyLooksLikeVoiceAi,
};

// Defense-in-depth: reject blurbs that look like copied/paraphrased review text
// rather than generic labels. Generic labels like "reviewed on G2 as a voice AI
// agency" are short and quote-free; actual review text would contain quotes,
// specific numbers, or lengthy descriptions.
function looksLikeGenericLabel(blurb: string | null): boolean {
  if (!blurb) return true; // null blurbs are fine

  // Reject if contains quotation marks (quote-like characters)
  if (/["""'']/i.test(blurb)) return false;

  // Reject if unusually long for a generic label (threshold: ~120 chars)
  // Generic: "reviewed on G2 as a voice AI agency" (34 chars)
  // Generic: "listed on Capterra as AI voice agent provider" (47 chars)
  // Likely review quote: "They built a robust voice AI platform with excellent customer support and competitive pricing" (92+ chars with adjectives)
  if (blurb.length > 120) return false;

  return true;
}

export async function findReviewSiteCandidates(perDay: number, shouldStop: () => boolean = () => false) {
  const result = await findCandidates(SPEC, perDay, shouldStop);

  // Post-process: filter candidates through generic-label check, moving
  // non-generic blurbs to rejected list
  const filtered: typeof result['candidates'] = [];
  const additionalRejected: string[] = [];

  for (const candidate of result.candidates) {
    if (looksLikeGenericLabel(candidate.blurb)) {
      filtered.push(candidate);
    } else {
      additionalRejected.push(candidate.domain);
    }
  }

  return {
    ...result,
    candidates: filtered,
    rejected: [...result.rejected, ...additionalRejected],
  };
}
