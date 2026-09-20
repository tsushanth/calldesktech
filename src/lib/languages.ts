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
  { code: 'es', label: 'Spanish', retell: 'es-419', stt: 'flux' },
  { code: 'fr', label: 'French', retell: 'fr-FR', stt: 'flux' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)', retell: 'pt-BR', stt: 'flux' },
  { code: 'it', label: 'Italian', retell: 'it-IT', stt: 'flux' },
  { code: 'nl', label: 'Dutch', retell: 'nl-NL', stt: 'flux' },
  { code: 'hi', label: 'Hindi', retell: 'hi-IN', stt: 'flux' },
  { code: 'de', label: 'German', retell: 'de-DE', stt: 'flux' },
  { code: 'pl', label: 'Polish', retell: 'pl-PL', stt: 'nova3' },
  { code: 'id', label: 'Indonesian', retell: 'id-ID', stt: 'nova3' },
  { code: 'ar', label: 'Arabic', retell: 'ar-SA', stt: 'nova3' },
];

/** Normalizes user input to a supported non-English code, 'en' for English/empty, or null if unsupported. */
export function normalizeLanguage(input: unknown): string | null {
  if (input === undefined || input === null || input === '') return 'en';
  if (typeof input !== 'string') return null;
  const c = input.trim();
  if (/^en([-_][A-Za-z]+)?$/i.test(c)) return 'en';
  const l = c.toLowerCase().replace('_', '-');
  if (l === 'pt' || l === 'pt-br') return 'pt-BR';
  return AGENT_LANGUAGES.find((a) => a.code.toLowerCase() === l || a.code.toLowerCase() === l.split('-')[0])?.code ?? null;
}

/** Non-English languages need a multilingual voice; the default (Kokoro) voice is English-only today. */
export function languageForcesPremiumVoice(code: string | null | undefined): boolean {
  return !!code && code !== 'en';
}

export const LANGUAGE_VALUES = ['en', ...AGENT_LANGUAGES.map((l) => l.code)];
