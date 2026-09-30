import { describe, it, expect, vi } from 'vitest';
import { generateSoundEffectWav as elevenLabsSoundEffect, pcm16ToWav } from '@/lib/callAudio/elevenlabsClient';
import { parseWav } from '@/lib/callAudio/mulaw';
import { ReadAloudError } from '@/lib/callAudio/readaloudClient';

const PCM = Buffer.alloc(8, 0); PCM.writeInt16LE(1000, 0); PCM.writeInt16LE(-2000, 2); PCM.writeInt16LE(3000, 4); PCM.writeInt16LE(-4000, 6);
const audioRes = (body: Buffer = PCM, status = 200) => new Response(new Uint8Array(body), { status, headers: { 'content-type': 'audio/pcm' } });
const opts = (f: unknown) => ({ apiKey: 'xi_test', fetchImpl: f as typeof fetch });

describe('pcm16ToWav', () => {
  it('wraps raw mono PCM16 as a WAV that parseWav reads back', () => {
    const w = parseWav(pcm16ToWav(PCM, 24000, 1));
    expect(w.sampleRate).toBe(24000);
    expect(Array.from(w.samples)).toEqual([1000, -2000, 3000, -4000]);
  });
  it('wraps interleaved stereo: the frame count is half the sample count, channels averaged', () => {
    const w = parseWav(pcm16ToWav(PCM, 24000, 2));
    expect(Array.from(w.samples)).toEqual([-500, -500]); // (1000 + -2000)/2, (3000 + -4000)/2
  });
});

describe('ElevenLabs generateSoundEffectWav', () => {
  it('POSTs to /v1/sound-generation asking for raw 24kHz PCM, with the api key header', async () => {
    const f = vi.fn(async () => audioRes());
    const wav = await elevenLabsSoundEffect({ prompt: 'a soft chime', durationSec: 2 }, opts(f));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/sound-generation?output_format=pcm_24000');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('xi_test');
    expect(JSON.parse(init.body as string)).toMatchObject({ text: 'a soft chime', duration_seconds: 2 });
    expect(parseWav(wav).sampleRate).toBe(24000);
    // Real bug from the first ElevenLabs phone test: sound-generation PCM is STEREO. Read as mono it came
    // out twice as long and an octave low. 4 samples = 2 stereo frames, averaged.
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(Array.from(parseWav(wav).samples)).toEqual([-500, -500]);
  });
  it('a 2s request yields ~2s of audio (frames = bytes / 4 at 24kHz), not 4s', async () => {
    const twoSeconds = Buffer.alloc(24000 * 2 * 2 * 2, 1); // 2s x 24kHz x 2ch x 2B
    const wav = await elevenLabsSoundEffect({ prompt: 'x', durationSec: 2 }, opts(async () => audioRes(twoSeconds)));
    const { samples, sampleRate } = parseWav(wav);
    expect(samples.length / sampleRate).toBeCloseTo(2, 1);
  });

  it.each([
    [401, 'unauthorized', false], [403, 'unauthorized', false], [402, 'payment_required', false],
    [422, 'invalid_input', false], [429, 'rate_limited', true], [500, 'upstream', true], [503, 'upstream', true],
  ])('maps HTTP %i to %s (retryable=%s)', async (status, code, retryable) => {
    const f = async () => new Response('{"detail":"x"}', { status });
    await expect(elevenLabsSoundEffect({ prompt: 'x', durationSec: 2 }, opts(f))).rejects.toMatchObject({ code, retryable });
    await expect(elevenLabsSoundEffect({ prompt: 'x', durationSec: 2 }, opts(f))).rejects.toBeInstanceOf(ReadAloudError);
  });

  it('an empty audio body is an upstream error, not a silent success', async () => {
    await expect(elevenLabsSoundEffect({ prompt: 'x', durationSec: 2 }, opts(async () => audioRes(Buffer.alloc(0)))))
      .rejects.toMatchObject({ code: 'upstream' });
  });

  it('a network failure is a retryable upstream error', async () => {
    await expect(elevenLabsSoundEffect({ prompt: 'x', durationSec: 2 }, opts(async () => { throw new Error('ECONNRESET'); })))
      .rejects.toMatchObject({ code: 'upstream', retryable: true });
  });

  it('validates before any network call (same 1-12s / 500-char limits as the UI promises) and requires a key', async () => {
    const f = vi.fn();
    await expect(elevenLabsSoundEffect({ prompt: ' ', durationSec: 2 }, opts(f))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(elevenLabsSoundEffect({ prompt: 'x'.repeat(501), durationSec: 2 }, opts(f))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(elevenLabsSoundEffect({ prompt: 'x', durationSec: 13 }, opts(f))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(elevenLabsSoundEffect({ prompt: 'x', durationSec: 2 }, { apiKey: '', fetchImpl: f as unknown as typeof fetch })).rejects.toMatchObject({ code: 'not_configured' });
    expect(f).not.toHaveBeenCalled();
  });
});
