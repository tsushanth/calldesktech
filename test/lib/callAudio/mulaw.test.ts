import { describe, it, expect } from 'vitest';
import { encodeMuLaw, decodeMuLaw, wavToMulaw8k, parseWav } from '@/lib/callAudio/mulaw';

// Builds a minimal RIFF/WAVE buffer. format 1 = PCM16, 3 = float32.
function makeWav(samples: number[][], rate: number, format: 1 | 3 = 1): Buffer {
  const channels = samples.length;
  const frames = samples[0].length;
  const bytesPer = format === 1 ? 2 : 4;
  const data = Buffer.alloc(frames * channels * bytesPer);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const off = (i * channels + c) * bytesPer;
      if (format === 1) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[c][i]))), off);
      else data.writeFloatLE(samples[c][i], off);
    }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(format, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * channels * bytesPer, 28); h.writeUInt16LE(channels * bytesPer, 32);
  h.writeUInt16LE(bytesPer * 8, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const tone = (hz: number, rate: number, seconds: number, amp = 12000) =>
  Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / xs.length);

describe('G.711 mu-law encode (reference bytes)', () => {
  // Standard G.711 values: +0 -> 0xFF, -1 -> 0x7F, full-scale +/- -> 0x80 / 0x00.
  it('matches known reference bytes', () => {
    expect(encodeMuLaw(0)).toBe(0xff);
    expect(encodeMuLaw(-1)).toBe(0x7f);
    expect(encodeMuLaw(32767)).toBe(0x80);
    expect(encodeMuLaw(-32768)).toBe(0x00);
    expect(encodeMuLaw(1000)).toBe(0xce);
    expect(encodeMuLaw(-1000)).toBe(0x4e);
  });
  it('round-trips within mu-law quantization error (~3% + floor)', () => {
    for (const s of [0, 5, 100, 1000, 8000, 20000, -100, -8000, -30000]) {
      const back = decodeMuLaw(encodeMuLaw(s));
      expect(Math.abs(back - s)).toBeLessThanOrEqual(Math.max(40, Math.abs(s) * 0.05));
    }
  });
});

describe('parseWav', () => {
  it('reads PCM16 mono', () => {
    const w = parseWav(makeWav([[0, 100, -100]], 8000));
    expect(w.sampleRate).toBe(8000);
    expect(Array.from(w.samples)).toEqual([0, 100, -100]);
  });
  it('downmixes stereo by averaging channels', () => {
    const w = parseWav(makeWav([[1000, 1000], [3000, -1000]], 8000));
    expect(Array.from(w.samples)).toEqual([2000, 0]);
  });
  it('reads float32 WAV, scaling to int16 range', () => {
    const w = parseWav(makeWav([[0, 0.5, -0.5]], 8000, 3));
    expect(Array.from(w.samples)).toEqual([0, 16384, -16384]);
  });
  it('rejects non-WAV, and unsupported bit depths', () => {
    expect(() => parseWav(Buffer.from('not a wav file at all, definitely not'))).toThrow(/WAV/);
    const w = makeWav([[0]], 8000);
    w.writeUInt16LE(24, 34); // claim 24-bit
    expect(() => parseWav(w)).toThrow(/unsupported/i);
  });
});

describe('wavToMulaw8k', () => {
  it('outputs 8kHz mono: 1s of 44.1kHz audio -> 8000 bytes', () => {
    const out = wavToMulaw8k(makeWav([tone(440, 44100, 1)], 44100));
    expect(out.length).toBe(8000);
  });
  it('keeps an in-band tone (1kHz) at near-full level', () => {
    const out = wavToMulaw8k(makeWav([tone(1000, 24000, 1)], 24000), { normalize: false });
    const decoded = Array.from(out.subarray(400, 7600)).map(decodeMuLaw); // skip filter edge transients
    expect(rms(decoded)).toBeGreaterThan(12000 * 0.707 * 0.85);
  });
  it('strongly attenuates an out-of-band tone (6kHz) instead of aliasing it into band', () => {
    // Naive decimation would fold 6kHz down to a loud 2kHz tone at ~full amplitude.
    const out = wavToMulaw8k(makeWav([tone(6000, 24000, 1)], 24000), { normalize: false });
    const decoded = Array.from(out.subarray(400, 7600)).map(decodeMuLaw);
    expect(rms(decoded)).toBeLessThan(12000 * 0.707 * 0.05);
  });
  it('passes 8kHz input through without resampling', () => {
    const out = wavToMulaw8k(makeWav([[0, 1000, -1000, 32767]], 8000), { normalize: false });
    expect(Array.from(out)).toEqual([0xff, 0xce, 0x4e, 0x80]);
  });
  it('rejects silent or empty audio (a blank asset would be a silent jingle)', () => {
    expect(() => wavToMulaw8k(makeWav([new Array(4000).fill(0)], 8000))).toThrow(/silent/i);
    expect(() => wavToMulaw8k(makeWav([[]], 8000))).toThrow(/empty|no audio/i);
  });
});

describe('mulawToWav (dashboard preview of a stored asset)', () => {
  it('produces a valid 8kHz mono PCM16 WAV that parses back to the decoded samples', async () => {
    const { mulawToWav } = await import('@/lib/callAudio/mulaw');
    const mulaw = Buffer.from([0xff, 0xce, 0x4e, 0x80]);
    const wav = mulawToWav(mulaw);
    const parsed = parseWav(wav);
    expect(parsed.sampleRate).toBe(8000);
    expect(Array.from(parsed.samples)).toEqual(Array.from(mulaw).map(decodeMuLaw));
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8); // RIFF size is consistent
  });
});

describe('loudness normalization (a quiet generated clip must be audible next to TTS speech)', () => {
  const decodedRms = (mu: Buffer) => rms(Array.from(mu).map(decodeMuLaw));
  // Measured on the real phone line: the agent's TTS speech is RMS ~2600-2800. A chime at equal RMS was
  // still "barely audible" (sparse tonal audio reads far quieter than dense speech), so the target is ~2x speech.
  it('raises a very quiet clip to the target level (~5000 RMS, about 2x the agent\'s speech)', () => {
    const out = wavToMulaw8k(makeWav([tone(1000, 24000, 1, 400)], 24000));
    const level = decodedRms(out.subarray(400, 7600));
    expect(level).toBeGreaterThan(5000 * 0.8);
    expect(level).toBeLessThan(5000 * 1.25);
  });
  it('turns a too-loud clip down rather than blasting the caller', () => {
    const out = wavToMulaw8k(makeWav([tone(1000, 24000, 1, 30000)], 24000));
    const level = decodedRms(out.subarray(400, 7600));
    expect(level).toBeLessThan(5000 * 1.25);
  });
  it('never clips: peaky audio is limited by the peak ceiling instead of hitting full scale', () => {
    // Mostly quiet with rare sharp spikes: matching RMS alone would push the spikes past full scale.
    const s = tone(1000, 24000, 1, 300).map((v, i) => (i % 2400 === 0 ? 20000 : v));
    const out = wavToMulaw8k(makeWav([s], 24000));
    const peak = Math.max(...Array.from(out).map((b) => Math.abs(decodeMuLaw(b))));
    expect(peak).toBeLessThanOrEqual(32767 * 0.9 + 600); // ceiling + mu-law quantization
  });
  it('does not turn a near-silent noise floor into loud hiss (gain is capped; true silence still rejected)', () => {
    const noise = Array.from({ length: 8000 }, (_, i) => (i % 2 === 0 ? 20 : -20)); // peak 20: just above the silence floor
    const out = wavToMulaw8k(makeWav([noise], 8000));
    expect(decodedRms(out)).toBeLessThan(5000 * 0.5);
    expect(() => wavToMulaw8k(makeWav([new Array(4000).fill(3)], 8000))).toThrow(/silent/i);
  });
});
