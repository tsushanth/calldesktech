import { findCandidates, type SourceSpec, type SearchCandidate } from './genericSource';
import { politeFetchText } from './http';

// readaloudai.org discovery, Segment B: broader realtime voice builders
// outside telephony -- voice agents, dubbing/localization, accessibility
// tools, IVR replacement, e-learning narration -- that mention using
// Deepgram, ElevenLabs, or Cartesia, or otherwise read as a realtime STT/TTS
// API builder. Search-based, same pattern as telephonyPlatformsSearch.ts.

export type { SearchCandidate };

const QUERIES = [
  'dubbing localization startup using ElevenLabs API',
  'accessibility screen reader product using realtime text-to-speech API',
  'e-learning narration platform using text-to-speech API',
  'IVR replacement product using Deepgram speech-to-text API',
  'voice product built with Cartesia realtime API',
  'startup building realtime speech-to-text text-to-speech voice app',
];

// Slot (not day) keyed -- see searchSource.ts's queriesForDay for why.
const SLOT_MS = 2 * 60 * 60_000; // 2 hours
export function sttTtsSignalQueriesForDay(now = new Date(), perDay = 2): string[] {
  const slotNumber = Math.floor(now.getTime() / SLOT_MS);
  return Array.from({ length: perDay }, (_, i) => QUERIES[(slotNumber + i) % QUERIES.length]);
}

const PROMPT = (query: string) => `Search the web for: ${query}

I want to find companies or products (not the speech-API providers themselves) building realtime voice products -- voice agents outside telephony, dubbing/localization tools, accessibility tools (e.g. screen readers, read-aloud tools), IVR replacement, or e-learning narration -- that mention using a realtime speech-to-text or text-to-speech API (such as Deepgram, ElevenLabs, or Cartesia), or otherwise clearly build on top of one. Exclude Deepgram, ElevenLabs, Cartesia, and generic voice-AI platforms (Retell, Bland, Vapi, Synthflow) themselves, plus directories and review/listicle sites.

Return ONLY a JSON array (at most 10 items) of objects with keys: name (the company/product), website (their own homepage URL, from the search results), location (if shown, else null), blurb (one factual sentence about the product or which speech provider they mention, from what you saw). Only include companies you actually saw in the search results. Use at most 4 web searches, then answer immediately. No commentary, no markdown fences.`;

const EXCLUDED_HOSTS = ['deepgram.com', 'elevenlabs.io', 'cartesia.ai', 'retellai.com', 'bland.ai', 'vapi.ai', 'synthflow.ai'];

const LOOKS_LIKE_VOICE_BUILDER = /(text-to-speech|speech-to-text|realtime voice|voice clone|dubbing|localization|localisation|narration|screen reader|accessibility|voice agent|ivr)/i;

async function verifyIsVoiceBuilder(domain: string): Promise<boolean> {
  const res = await politeFetchText(`https://${domain}`, 12000);
  if (!res.ok || res.text.length < 500) return false;
  return LOOKS_LIKE_VOICE_BUILDER.test(res.text.slice(0, 200_000));
}

const SPEC: SourceSpec = {
  signalSource: 'search',
  queriesForDay: sttTtsSignalQueriesForDay,
  promptFor: PROMPT,
  hostExclusions: EXCLUDED_HOSTS,
  verify: verifyIsVoiceBuilder,
};

export async function findSttTtsSignalCandidates(perDay: number, shouldStop: () => boolean = () => false) {
  return findCandidates(SPEC, perDay, shouldStop);
}
