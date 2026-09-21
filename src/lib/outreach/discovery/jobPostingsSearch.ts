import { findCandidates, verifyLooksLikeVoiceAi, type SourceSpec, type SearchCandidate } from './genericSource';

// Finds agencies publicly hiring for voice-AI-related roles via Claude web
// search — broader coverage than the RemoteOK-only feed in
// ../signals/jobPostings.ts (which stays in place; pipeline.ts merges both).
// A live job posting for "Retell engineer" or similar is a strong signal
// they're actively building/scaling this, not just dabbling.

export type { SearchCandidate };

const ROLE_QUERIES = [
  'agency hiring Retell AI engineer job posting',
  'agency hiring Vapi voice AI developer job posting',
  'agency hiring "voice AI agent" engineer job posting',
  'agency hiring conversational AI phone engineer job posting',
  'company job posting "AI receptionist" build voice agents',
];

export function jobPostingQueriesForDay(now = new Date(), perDay = 2): string[] {
  const dayNumber = Math.floor(now.getTime() / 86_400_000);
  return Array.from({ length: perDay }, (_, i) => ROLE_QUERIES[(dayNumber + i) % ROLE_QUERIES.length]);
}

const PROMPT = (query: string) => `Search the web for: ${query}

I want to find small/mid-size agencies (not the voice-AI platforms themselves, not big enterprises) that have PUBLICLY POSTED a job opening for a role building or integrating AI voice agents / voice AI phone systems for their own clients. This is a hiring-intent signal, not a general company search.

Return ONLY a JSON array (at most 10 items) of objects with keys: name (the hiring company), website (their own homepage URL, from the search results — not the job board's URL), location (if shown, else null), blurb (the job title or a one-sentence description of the role, so it's clear this came from an actual posting). Only include companies you actually saw posting such a role in the search results. Use at most 4 web searches, then answer immediately. No commentary, no markdown fences.`;

const EXCLUDED_HOSTS = ['indeed.com', 'linkedin.com', 'glassdoor.com', 'ziprecruiter.com', 'remoteok.com', 'weworkremotely.com', 'retellai.com', 'vapi.ai', 'bland.ai'];

const SPEC: SourceSpec = {
  signalSource: 'job_posting',
  queriesForDay: jobPostingQueriesForDay,
  promptFor: PROMPT,
  hostExclusions: EXCLUDED_HOSTS,
  verify: verifyLooksLikeVoiceAi,
};

export async function findJobPostingCandidates(perDay: number, shouldStop: () => boolean = () => false) {
  return findCandidates(SPEC, perDay, shouldStop);
}
