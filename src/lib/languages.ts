// Agent languages (globalSettings.language). English is the default and needs no setting.
// The voice engine (call-loop-poc/languages.js) owns the real STT/TTS/prompt behavior; this
// file is the web-side list: what the builder offers, what the API accepts, and which TTS
// backend a language forces (so the version's tts_backend, and therefore the billed voice
// rate, matches what the engine will actually use).

export interface AgentLanguage {
  code: string;
  label: string;
  /** Retell `language` field for the equivalent Retell agent. */
  retell: string;
  /** Deepgram STT family the engine uses (informational). */
  stt: 'flux' | 'nova3';
}

export const AGENT_LANGUAGES: AgentLanguage[] = [
  // Deepgram Flux multilingual (v2, semantic end-of-turn)
  { code: 'es', label: 'Spanish', retell: 'es-419', stt: 'flux' },
  { code: 'fr', label: 'French', retell: 'fr-FR', stt: 'flux' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)', retell: 'pt-BR', stt: 'flux' },
  { code: 'it', label: 'Italian', retell: 'it-IT', stt: 'flux' },
  { code: 'nl', label: 'Dutch', retell: 'nl-NL', stt: 'flux' },
  { code: 'de', label: 'German', retell: 'de-DE', stt: 'flux' },
  { code: 'hi', label: 'Hindi', retell: 'hi-IN', stt: 'flux' },
  { code: 'ja', label: 'Japanese', retell: 'ja', stt: 'flux' },
  { code: 'ru', label: 'Russian', retell: 'ru', stt: 'flux' },
  // Deepgram Nova-3 (v1, endpointing + UtteranceEnd)
  { code: 'pl', label: 'Polish', retell: 'pl-PL', stt: 'nova3' },
  { code: 'id', label: 'Indonesian', retell: 'id-ID', stt: 'nova3' },
  { code: 'ar', label: 'Arabic', retell: 'ar-SA', stt: 'nova3' },
  { code: 'zh', label: 'Chinese (Mandarin)', retell: 'zh', stt: 'nova3' },
  { code: 'ko', label: 'Korean', retell: 'ko', stt: 'nova3' },
  { code: 'tr', label: 'Turkish', retell: 'tr', stt: 'nova3' },
  { code: 'el', label: 'Greek', retell: 'el', stt: 'nova3' },
  { code: 'bg', label: 'Bulgarian', retell: 'bg', stt: 'nova3' },
  { code: 'hr', label: 'Croatian', retell: 'hr', stt: 'nova3' },
  { code: 'cs', label: 'Czech', retell: 'cs', stt: 'nova3' },
  { code: 'da', label: 'Danish', retell: 'da', stt: 'nova3' },
  { code: 'tl', label: 'Filipino', retell: 'tl', stt: 'nova3' },
  { code: 'fi', label: 'Finnish', retell: 'fi', stt: 'nova3' },
  { code: 'ms', label: 'Malay', retell: 'ms', stt: 'nova3' },
  { code: 'ro', label: 'Romanian', retell: 'ro', stt: 'nova3' },
  { code: 'sk', label: 'Slovak', retell: 'sk', stt: 'nova3' },
  { code: 'sv', label: 'Swedish', retell: 'sv', stt: 'nova3' },
  { code: 'ta', label: 'Tamil', retell: 'ta', stt: 'nova3' },
  { code: 'uk', label: 'Ukrainian', retell: 'uk', stt: 'nova3' },
  { code: 'hu', label: 'Hungarian', retell: 'hu', stt: 'nova3' },
  { code: 'no', label: 'Norwegian', retell: 'no', stt: 'nova3' },
  { code: 'vi', label: 'Vietnamese', retell: 'vi', stt: 'nova3' },
  { code: 'bn', label: 'Bengali', retell: 'bn', stt: 'nova3' },
  { code: 'th', label: 'Thai', retell: 'th', stt: 'nova3' },
  { code: 'ka', label: 'Georgian', retell: 'ka', stt: 'nova3' },
  { code: 'te', label: 'Telugu', retell: 'te', stt: 'nova3' },
  { code: 'gu', label: 'Gujarati', retell: 'gu', stt: 'nova3' },
  { code: 'kn', label: 'Kannada', retell: 'kn', stt: 'nova3' },
  { code: 'mr', label: 'Marathi', retell: 'mr', stt: 'nova3' },
  { code: 'pa', label: 'Punjabi', retell: 'pa', stt: 'nova3' },
  { code: 'ur', label: 'Urdu', retell: 'ur', stt: 'nova3' },
  { code: 'he', label: 'Hebrew', retell: 'he', stt: 'nova3' },
  { code: 'ca', label: 'Catalan', retell: 'ca', stt: 'nova3' },
  { code: 'lt', label: 'Lithuanian', retell: 'lt', stt: 'nova3' },
  { code: 'hy', label: 'Armenian', retell: 'hy', stt: 'nova3' },
  { code: 'yue', label: 'Cantonese', retell: 'zh-HK', stt: 'nova3' },
  { code: 'af', label: 'Afrikaans', retell: 'af', stt: 'nova3' },
  { code: 'bs', label: 'Bosnian', retell: 'bs', stt: 'nova3' },
  { code: 'ne', label: 'Nepali', retell: 'ne', stt: 'nova3' },
];

/** Normalizes user input to a supported non-English code, 'en' for English/empty, or null if unsupported. */
export function normalizeLanguage(input: unknown): string | null {
  if (input === undefined || input === null || input === '') return 'en';
  if (typeof input !== 'string') return null;
  const c = input.trim();
  if (/^en([-_][A-Za-z]+)?$/i.test(c)) return 'en';
  const l = c.toLowerCase().replace('_', '-');
  if (l === 'pt' || l === 'pt-br' || l === 'pt_br') return 'pt-BR';
  return AGENT_LANGUAGES.find((a) => a.code.toLowerCase() === l || a.code.toLowerCase() === l.split('-')[0])?.code ?? null;
}

/** Non-English languages need a multilingual voice; the default (Kokoro) voice is English-only today. */
export function languageForcesPremiumVoice(code: string | null | undefined): boolean {
  return !!code && code !== 'en';
}

export const LANGUAGE_VALUES = ['en', ...AGENT_LANGUAGES.map((l) => l.code)];
