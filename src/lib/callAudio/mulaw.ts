// WAV -> mu-law @ 8kHz mono, the wire format call-loop-poc plays straight to Twilio (see
// realtime-tts call-loop-poc/callAudio.js). Pure TypeScript on purpose: this app's container is
// Alpine with no ffmpeg, and the conversion is small. The resampler applies a real windowed-sinc
// low-pass before decimating — call-loop-poc's own naive resampler is documented there as
// aliasing audibly on 24k->8k, which is exactly what this must not do.

const BIAS = 0x84;
const CLIP = 32635;
const TARGET_RATE = 8000;
// Below this peak amplitude (of 32768) the clip is treated as silence.
const SILENT_PEAK = 16;
// Loudness the clip is normalized to. Generated audio comes back very quiet (a real ReadAloud chime
// measured RMS ~450 / -20 dBFS peak), and an un-normalized jingle plays far under the agent's voice.
// Measured on the real phone line, the agent's TTS speech is RMS ~2600-2800. Matching that (2500) still
// left a chime "barely audible" in a live call: sparse, tonal audio reads much quieter than dense speech
// at the same RMS. So target ~2x speech (+6dB); the peak ceiling below is what keeps it from clipping.
const TARGET_RMS = 5000;
// Hard ceiling so a peaky clip (sharp transients) is limited instead of clipping at full scale.
const PEAK_CEILING = 32767 * 0.9;
// Never amplify more than this (26dB): a near-silent noise floor must not become loud hiss.
const MAX_GAIN = 20;

// Standard G.711 mu-law encoder for one signed 16-bit sample.
export function encodeMuLaw(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  let s = sample < 0 ? -sample : sample;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function decodeMuLaw(byte: number): number {
  const b = ~byte & 0xff;
  const sign = b & 0x80;
  const exponent = (b >> 4) & 0x07;
  const mantissa = b & 0x0f;
  const magnitude = (((mantissa << 3) + BIAS) << exponent) - BIAS;
  return sign ? -magnitude : magnitude;
}

export interface ParsedWav {
  sampleRate: number;
  /** Mono, int16-range values (float WAVs are scaled). */
  samples: Float64Array;
}

export function parseWav(buf: Buffer): ParsedWav {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a WAV file');
  }
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  for (let off = 12; off + 8 <= buf.length; ) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, Math.min(off + 8 + size, buf.length));
    if (id === 'fmt ' && body.length >= 16) {
      let format = body.readUInt16LE(0);
      if (format === 0xfffe && body.length >= 26) format = body.readUInt16LE(24); // WAVE_FORMAT_EXTENSIBLE subformat
      fmt = { format, channels: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
    } else if (id === 'data') {
      data = body;
    }
    off += 8 + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt || !data) throw new Error('Not a valid WAV file (missing fmt or data chunk)');
  const { format, channels, rate, bits } = fmt;
  const isPcm16 = format === 1 && bits === 16;
  const isFloat32 = format === 3 && bits === 32;
  if (!isPcm16 && !isFloat32) throw new Error(`Unsupported WAV encoding (format ${format}, ${bits}-bit)`);
  if (channels < 1 || rate < 1) throw new Error('Unsupported WAV header');

  const bytesPer = bits / 8;
  const frames = Math.floor(data.length / (bytesPer * channels));
  const samples = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const off = (i * channels + c) * bytesPer;
      sum += isPcm16 ? data.readInt16LE(off) : data.readFloatLE(off) * 32768;
    }
    samples[i] = sum / channels;
  }
  return { sampleRate: rate, samples };
}

// Windowed-sinc (Blackman) low-pass at ~3.6kHz applied at each output instant, i.e. filter and
// decimate in one pass. Samples outside the clip count as silence.
function resampleTo8k(src: Float64Array, srcRate: number): Float64Array {
  if (srcRate === TARGET_RATE) return src;
  const ratio = srcRate / TARGET_RATE;
  const outLen = Math.floor(src.length / ratio);
  const cutoff = Math.min(0.45 * TARGET_RATE, 0.45 * srcRate) / srcRate; // cycles per source sample
  const halfWidth = Math.ceil(8 / (2 * cutoff)); // ~16 lobes of the cutoff sinc: ample stopband
  const out = new Float64Array(outLen);
  for (let n = 0; n < outLen; n++) {
    const center = n * ratio;
    const first = Math.ceil(center - halfWidth);
    const last = Math.floor(center + halfWidth);
    let acc = 0;
    for (let k = first; k <= last; k++) {
      if (k < 0 || k >= src.length) continue;
      const x = k - center;
      const sinc = x === 0 ? 1 : Math.sin(2 * Math.PI * cutoff * x) / (2 * Math.PI * cutoff * x);
      const t = (x + halfWidth) / (2 * halfWidth); // 0..1 across the window
      const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * t) + 0.08 * Math.cos(4 * Math.PI * t);
      acc += src[k] * 2 * cutoff * sinc * w;
    }
    out[n] = acc;
  }
  return out;
}

export function wavToMulaw8k(wav: Buffer, opts: { normalize?: boolean } = {}): Buffer {
  const { sampleRate, samples } = parseWav(wav);
  if (samples.length === 0) throw new Error('WAV contains no audio');
  const pcm = resampleTo8k(samples, sampleRate);
  let peak = 0;
  let sumSq = 0;
  for (const s of pcm) {
    peak = Math.max(peak, Math.abs(s));
    sumSq += s * s;
  }
  if (peak < SILENT_PEAK) throw new Error('Generated audio is silent');
  // Gain toward the target RMS, but never past the peak ceiling or the max-gain cap.
  const rms = Math.sqrt(sumSq / pcm.length);
  const gain = opts.normalize === false ? 1 : Math.min(TARGET_RMS / rms, PEAK_CEILING / peak, MAX_GAIN);
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = encodeMuLaw(Math.round(pcm[i] * gain));
  return out;
}

// Wraps stored mu-law bytes as a playable 8kHz mono PCM16 WAV, for previewing an asset in the
// dashboard (browsers can't play raw G.711 bytes).
export function mulawToWav(mulaw: Buffer): Buffer {
  const dataLen = mulaw.length * 2;
  const wav = Buffer.alloc(44 + dataLen);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataLen, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(TARGET_RATE, 24); wav.writeUInt32LE(TARGET_RATE * 2, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < mulaw.length; i++) wav.writeInt16LE(decodeMuLaw(mulaw[i]), 44 + i * 2);
  return wav;
}
