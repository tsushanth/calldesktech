#!/usr/bin/env node
// Generates the SHARED jingle + sound effects used by the vertical sample calls (scripts/lib/sample-audio.mjs):
// 3 sounds in total, reused across verticals. Runs through the SAME pipeline customers get (ElevenLabs sound
// generation -> src/lib/callAudio/mulaw.ts: stereo downmix, anti-alias filter, loudness normalization), so the
// samples sound like the product.
//
//   npx tsx --env-file=.env scripts/generate-sample-audio.mjs [--force]
//
// Needs ELEVENLABS_SOUNDS_API_KEY or ELEVENLABS_API_KEY (with the sound_generation permission). Writes
//   out/sample-audio/shared.json   { <sound>: { audio: base64 mu-law@8kHz, prompt, durationSec, bytes } }
//   out/sample-audio/<sound>.wav   a playable preview of exactly what callers will hear
// Existing sounds are kept (each generation costs credits); pass --force to regenerate. Run with tsx because it
// imports the TypeScript pipeline directly.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHARED_SOUNDS } from './lib/sample-audio.mjs';
import { makeWavGenerator } from '../src/lib/callAudio/generate.ts';
import { wavToMulaw8k, mulawToWav, decodeMuLaw } from '../src/lib/callAudio/mulaw.ts';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = join(ROOT, 'out/sample-audio');
const FILE = join(OUT, 'shared.json');
const force = process.argv.includes('--force');

const existing = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
const generate = makeWavGenerator(process.env);
mkdirSync(OUT, { recursive: true });

for (const [key, spec] of Object.entries(SHARED_SOUNDS)) {
  if (existing[key]?.audio && !force) { console.log(`${key}: already generated, keeping (use --force to regenerate)`); continue; }
  console.log(`${key}: generating ${spec.durationSec}s "${spec.prompt}" ...`);
  const mulaw = wavToMulaw8k(await generate({ prompt: spec.prompt, durationSec: spec.durationSec }));
  const pcm = Array.from(mulaw, decodeMuLaw);
  const rms = Math.sqrt(pcm.reduce((a, v) => a + v * v, 0) / pcm.length);
  console.log(`  -> ${(mulaw.length / 8000).toFixed(2)}s, RMS ${rms.toFixed(0)} (agent speech is ~2700), peak ${Math.max(...pcm.map(Math.abs))}`);
  existing[key] = { audio: mulaw.toString('base64'), prompt: spec.prompt, durationSec: spec.durationSec, bytes: mulaw.length };
  writeFileSync(join(OUT, `${key}.wav`), mulawToWav(mulaw));
}
writeFileSync(FILE, JSON.stringify(existing));
console.log(`\nwrote ${FILE}\npreview the sounds: ${OUT}/*.wav`);
