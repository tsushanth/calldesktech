/**
 * Static voice library by engine. Each voice entry matches the shape the
 * MCP client's `list_voices` / `get_voice` expects:
 * { id, name, gender, language, accent, engine, tts_backend?, sample_url? }
 *
 * On first call to list_voices for a tenant, the backend seeds these rows
 * into calldesk_voices so the user can rename, hide, or favourite them.
 */

export interface VoiceDef {
  id: string;
  name: string;
  gender?: string;
  language: string;
  accent?: string;
  engine: 'poc' | 'retell';
  tts_backend?: 'kokoro' | 'elevenlabs' | 'cartesia' | 'minimax' | 'piper';
  sample_url?: string;
}

const POC_VOICES: VoiceDef[] = [
  { id: 'kokoro-af', name: 'Aurora (Kokoro)', gender: 'female', language: 'en', accent: 'US', engine: 'poc', tts_backend: 'kokoro' },
  { id: 'kokoro-am', name: 'Apollo (Kokoro)', gender: 'male', language: 'en', accent: 'US', engine: 'poc', tts_backend: 'kokoro' },
  { id: 'kokoro-bf', name: 'Bella (Kokoro)', gender: 'female', language: 'en', accent: 'GB', engine: 'poc', tts_backend: 'kokoro' },
  { id: 'kokoro-bm', name: 'Benjamin (Kokoro)', gender: 'male', language: 'en', accent: 'GB', engine: 'poc', tts_backend: 'kokoro' },
  { id: '11labs-Adrian', name: 'Adrian (ElevenLabs)', gender: 'male', language: 'en', accent: 'US', engine: 'poc', tts_backend: 'elevenlabs' },
  { id: '11labs-Marissa', name: 'Marissa (ElevenLabs)', gender: 'female', language: 'en', accent: 'US', engine: 'poc', tts_backend: 'elevenlabs' },
  { id: '11labs-Liam', name: 'Liam (ElevenLabs)', gender: 'male', language: 'en', accent: 'GB', engine: 'poc', tts_backend: 'elevenlabs' },
  { id: '11labs-Sophia', name: 'Sophia (ElevenLabs)', gender: 'female', language: 'en', accent: 'GB', engine: 'poc', tts_backend: 'elevenlabs' },
  { id: 'cartesia-Default-Female', name: 'Default Female (Cartesia)', gender: 'female', language: 'en', accent: 'US', engine: 'poc', tts_backend: 'cartesia' },
  { id: 'cartesia-Default-Male', name: 'Default Male (Cartesia)', gender: 'male', language: 'en', accent: 'US', engine: 'poc', tts_backend: 'cartesia' },
  { id: 'minimax-100001', name: 'Emma (MiniMax)', gender: 'female', language: 'en', accent: 'US', engine: 'poc', tts_backend: 'minimax' },
  { id: 'minimax-100002', name: 'James (MiniMax)', gender: 'male', language: 'en', accent: 'US', engine: 'poc', tts_backend: 'minimax' },
  // Multilingual poc voices (pinned to ElevenLabs)
  { id: '11labs-Charlotte-es', name: 'Charlotte (ES)', gender: 'female', language: 'es', accent: 'ES', engine: 'poc', tts_backend: 'elevenlabs' },
  { id: '11labs-Pierre-fr', name: 'Pierre (FR)', gender: 'male', language: 'fr', accent: 'FR', engine: 'poc', tts_backend: 'elevenlabs' },
  { id: '11labs-Giulia-it', name: 'Giulia (IT)', gender: 'female', language: 'it', accent: 'IT', engine: 'poc', tts_backend: 'elevenlabs' },
  { id: '11labs-Hans-de', name: 'Hans (DE)', gender: 'male', language: 'de', accent: 'DE', engine: 'poc', tts_backend: 'elevenlabs' },
  { id: '11labs-Priya-hi', name: 'Priya (HI)', gender: 'female', language: 'hi', accent: 'IN', engine: 'poc', tts_backend: 'elevenlabs' },
  { id: '11labs-Aisha-ar', name: 'Aisha (AR)', gender: 'female', language: 'ar', accent: 'SA', engine: 'poc', tts_backend: 'elevenlabs' },
];

const RETELL_VOICES: VoiceDef[] = [
  { id: 'retell-Brian', name: 'Brian', gender: 'male', language: 'en', accent: 'US', engine: 'retell' },
  { id: 'retell-Sarah', name: 'Sarah', gender: 'female', language: 'en', accent: 'US', engine: 'retell' },
  { id: 'retell-Josh', name: 'Josh', gender: 'male', language: 'en', accent: 'GB', engine: 'retell' },
  { id: 'retell-Emily', name: 'Emily', gender: 'female', language: 'en', accent: 'GB', engine: 'retell' },
  { id: 'retell-Ben', name: 'Ben', gender: 'male', language: 'en', accent: 'AU', engine: 'retell' },
  { id: 'retell-Alison', name: 'Alison', gender: 'female', language: 'en', accent: 'AU', engine: 'retell' },
];

export function getStaticVoices(engine: 'poc' | 'retell'): VoiceDef[] {
  return engine === 'poc' ? POC_VOICES : RETELL_VOICES;
}
