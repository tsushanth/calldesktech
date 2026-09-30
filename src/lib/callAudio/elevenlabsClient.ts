// ElevenLabs Sound Effects (POST /v1/sound-generation) as the generation provider for call audio.
// Used while ReadAloud's own sound-effects/music generation is being perfected (see generate.ts to
// switch back). Asks for raw 24kHz PCM so the audio goes through the same WAV -> mu-law@8kHz
// conversion (filtering + loudness normalization) as any other provider. Configuration-time only,
// never called during a live call.
import { ReadAloudError } from './readaloudClient';

const SOUND_EFFECT_MIN_SEC = 1;
const SOUND_EFFECT_MAX_SEC = 12;
const MAX_PROMPT_CHARS = 500;
const PCM_RATE = 24000;
// Measured against the real API: sound-generation PCM is interleaved STEREO, not mono (a 2s request
// returns 2s x 24000 x 2ch x 2B = 192000 bytes). Read as mono it came out 2x too long and an octave
// low. The channels are downmixed to mono by the shared converter.
const PCM_CHANNELS = 2;
const ENDPOINT = `https://api.elevenlabs.io/v1/sound-generation?output_format=pcm_${PCM_RATE}`;

// Raw interleaved PCM16LE -> a minimal WAV, so downstream code has one input format.
export function pcm16ToWav(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2 * channels, 28); h.writeUInt16LE(2 * channels, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export interface ElevenLabsOptions {
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function generateSoundEffectWav(
  input: { prompt: string; durationSec: number },
  opts: ElevenLabsOptions
): Promise<Buffer> {
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    throw new ReadAloudError('invalid_input', `Prompt must be 1-${MAX_PROMPT_CHARS} characters.`);
  }
  if (!(input.durationSec >= SOUND_EFFECT_MIN_SEC && input.durationSec <= SOUND_EFFECT_MAX_SEC)) {
    throw new ReadAloudError('invalid_input', `Duration must be ${SOUND_EFFECT_MIN_SEC}-${SOUND_EFFECT_MAX_SEC} seconds.`);
  }
  if (!opts.apiKey) throw new ReadAloudError('not_configured', 'ELEVENLABS_API_KEY is not configured.');

  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(ENDPOINT, {
      method: 'POST',
      headers: { 'xi-api-key': opts.apiKey, 'Content-Type': 'application/json' },
      // Higher prompt_influence: short UI-style sounds should follow the description closely, not improvise.
      body: JSON.stringify({ text: prompt, duration_seconds: input.durationSec, prompt_influence: 0.5 }),
      cache: 'no-store',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
  } catch {
    throw new ReadAloudError('upstream', 'Could not reach ElevenLabs.', true);
  }

  if (res.status === 401 || res.status === 403) throw new ReadAloudError('unauthorized', 'ElevenLabs rejected the API key.');
  if (res.status === 402) throw new ReadAloudError('payment_required', 'ElevenLabs quota or plan does not allow sound generation.');
  if (res.status === 422) throw new ReadAloudError('invalid_input', 'ElevenLabs rejected this description.');
  if (res.status === 429) throw new ReadAloudError('rate_limited', 'ElevenLabs rate limit hit; retry shortly.', true);
  if (!res.ok) throw new ReadAloudError('upstream', `ElevenLabs returned HTTP ${res.status}.`, res.status >= 500);

  const pcm = Buffer.from(await res.arrayBuffer());
  if (pcm.length < 2) throw new ReadAloudError('upstream', 'ElevenLabs returned no audio.', true);
  return pcm16ToWav(pcm, PCM_RATE, PCM_CHANNELS);
}
