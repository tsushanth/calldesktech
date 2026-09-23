import { findCandidates, type SourceSpec, type SearchCandidate } from './genericSource';
import { politeFetchText } from './http';

// readaloudai.org discovery, Segment A: AI telephony / voice-agent platforms
// (Retell, Bland, Vapi, Synthflow, and smaller/regional competitors) that
// currently pay a speech provider (Deepgram, ElevenLabs, Cartesia) for
// STT/TTS on every call. Search-based, following the same
// search -> parse -> verify loop as jobPostingsSearch.ts/githubSignal.ts, not
// a directory scraper like retellDirectory.ts.

export type { SearchCandidate };

const QUERIES = [
  'AI voice agent platform built on Deepgram speech API',
  'AI voice agent platform built on ElevenLabs text to speech',
  'AI voice agent platform using Cartesia realtime voice API',
  'telephony AI agent platform startup speech-to-text text-to-speech provider',
  'regional AI phone agent / voice agent platform competitor to Retell Bland Vapi',
];

// Slot (not day) keyed -- see searchSource.ts's queriesForDay for why.
const SLOT_MS = 2 * 60 * 60_000; // 2 hours
export function telephonyPlatformsQueriesForDay(now = new Date(), perDay = 2): string[] {
  const slotNumber = Math.floor(now.getTime() / SLOT_MS);
  return Array.from({ length: perDay }, (_, i) => QUERIES[(slotNumber + i) % QUERIES.length]);
}

const PROMPT = (query: string) => `Search the web for: ${query}

I want to find AI telephony / voice-agent PLATFORMS (companies like Retell, Bland, Vapi, Synthflow, or smaller/regional competitors that let other businesses build phone/voice agents) that currently rely on a third-party speech-to-text or text-to-speech API (such as Deepgram, ElevenLabs, or Cartesia) to power their product. Exclude Retell, Bland, Vapi, Synthflow, Deepgram, ElevenLabs, and Cartesia themselves, plus directories and review/listicle sites.

Return ONLY a JSON array (at most 10 items) of objects with keys: name (the platform), website (their own homepage URL, from the search results), location (if shown, else null), blurb (one factual sentence, e.g. which speech provider they mention using, from what you saw). Only include companies you actually saw in the search results. Use at most 4 web searches, then answer immediately. No commentary, no markdown fences.`;

const EXCLUDED_HOSTS = ['retellai.com', 'bland.ai', 'vapi.ai', 'synthflow.ai', 'deepgram.com', 'elevenlabs.io', 'cartesia.ai'];

// The candidate must be a voice/telephony AI product, not just any startup
// that happens to be indexed by a search engine.
const LOOKS_LIKE_VOICE_PLATFORM = /(voice agent|voice ai|phone agent|telephony|ivr|conversational ai|speech-to-text|text-to-speech|realtime voice)/i;

async function verifyIsTelephonyPlatform(domain: string): Promise<boolean> {
  const res = await politeFetchText(`https://${domain}`, 12000);
  if (!res.ok || res.text.length < 500) return false;
  return LOOKS_LIKE_VOICE_PLATFORM.test(res.text.slice(0, 200_000));
}

const SPEC: SourceSpec = {
  signalSource: 'search',
  queriesForDay: telephonyPlatformsQueriesForDay,
  promptFor: PROMPT,
  hostExclusions: EXCLUDED_HOSTS,
  verify: verifyIsTelephonyPlatform,
};

export async function findTelephonyPlatformCandidates(perDay: number, shouldStop: () => boolean = () => false) {
  return findCandidates(SPEC, perDay, shouldStop);
}
