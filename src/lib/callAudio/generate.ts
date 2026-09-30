// Picks the audio-generation provider for call-audio assets. ElevenLabs is the default while
// ReadAloud's own sound-effects/music generation is perfected; set CALL_AUDIO_PROVIDER=readaloud to
// switch back (both need their own API key). An unknown value fails closed rather than silently
// spending on a provider nobody chose.
import { generateSoundEffectWav as elevenlabsGenerate } from './elevenlabsClient';
import { generateSoundEffectWav as readaloudGenerate, ReadAloudError, type ReadAloudOptions } from './readaloudClient';
import type { ElevenLabsOptions } from './elevenlabsClient';

type Input = { prompt: string; durationSec: number };

export interface GeneratorImpls {
  elevenlabs: (input: Input, opts: ElevenLabsOptions) => Promise<Buffer>;
  readaloud: (input: Input, opts: ReadAloudOptions) => Promise<Buffer>;
}

const DEFAULT_IMPLS: GeneratorImpls = { elevenlabs: elevenlabsGenerate, readaloud: readaloudGenerate };
const DEFAULT_READALOUD_URL = 'https://readaloudai.org/mcp';

export function makeWavGenerator(
  env: Record<string, string | undefined> = process.env,
  impls: GeneratorImpls = DEFAULT_IMPLS
): (input: Input) => Promise<Buffer> {
  const provider = (env.CALL_AUDIO_PROVIDER || 'elevenlabs').trim().toLowerCase();
  return async (input) => {
    if (provider === 'elevenlabs') {
      // A dedicated key first: ElevenLabs keys can be permission-restricted, and the general
      // ELEVENLABS_API_KEY on the web app is (it lacks sound_generation). Falls back to the general key.
      const apiKey = env.ELEVENLABS_SOUNDS_API_KEY?.trim() || env.ELEVENLABS_API_KEY;
      return impls.elevenlabs(input, { apiKey });
    }
    if (provider === 'readaloud') {
      return impls.readaloud(input, { apiKey: env.READALOUD_API_KEY, url: env.READALOUD_MCP_URL || DEFAULT_READALOUD_URL });
    }
    throw new ReadAloudError('not_configured', `Unknown CALL_AUDIO_PROVIDER "${provider}"`);
  };
}
