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
    if (provider === 'elevenlabs') return impls.elevenlabs(input, { apiKey: env.ELEVENLABS_API_KEY });
    if (provider === 'readaloud') {
      return impls.readaloud(input, { apiKey: env.READALOUD_API_KEY, url: env.READALOUD_MCP_URL || DEFAULT_READALOUD_URL });
    }
    throw new ReadAloudError('not_configured', `Unknown CALL_AUDIO_PROVIDER "${provider}"`);
  };
}
