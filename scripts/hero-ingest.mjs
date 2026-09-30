#!/usr/bin/env node
// Turns the original Envato video masters into the small web clips the landing
// hero rotates through, and records each one in src/data/heroPool.json.
//
//   node scripts/hero-ingest.mjs --src ~/Downloads [--force]
//
// scripts/hero-sources.json lists each master (file name relative to --src, or an
// absolute path), the scenario it belongs to, and its Envato item (for the
// license record). Needs ffmpeg and ffprobe on the PATH. Re-running skips clips
// that already exist unless --force is given, so adding a batch is: download the
// masters, add their entries to hero-sources.json, run this, commit public/hero.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const SRC = opt('src', path.join(homedir(), 'Downloads')).replace(/^~/, homedir());
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public', 'hero');
const MANIFEST = path.join(ROOT, 'src', 'data', 'heroPool.json');
const SECONDS = 9; // each loop
const WIDTH = 1280;

const { license, sources } = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'hero-sources.json'), 'utf8'));
mkdirSync(OUT, { recursive: true });
mkdirSync(path.dirname(MANIFEST), { recursive: true });

const probe = (file) => {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,color_transfer', '-show_entries', 'format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(out);
  const [n, d] = j.streams[0].r_frame_rate.split('/').map(Number);
  return { width: j.streams[0].width, height: j.streams[0].height, fps: n / (d || 1), duration: Number(j.format.duration), untagged: !j.streams[0].color_transfer || j.streams[0].color_transfer === 'unknown' };
};

const pool = [];
for (const s of sources) {
  const expanded = s.file.replace(/^~/, homedir());
  const file = path.isAbsolute(expanded) ? expanded : path.join(SRC, expanded);
  const id = `${s.scenario}-${s.itemId ?? s.slug}`;
  const video = path.join(OUT, `${id}.mp4`);
  const poster = path.join(OUT, `${id}.jpg`);
  if (!existsSync(file)) { console.warn(`missing master, skipped: ${file}`); if (!existsSync(video)) continue; }
  else if (flag('force') || !existsSync(video) || !existsSync(poster)) {
    const info = probe(file);
    // Some masters carry no color tags, which ffmpeg cannot convert; tag them as standard web video.
    const tag = info.untagged ? 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709,' : '';
    const vf = `${tag}scale=${WIDTH}:-2:flags=lanczos,format=yuv420p`;
    const rate = info.fps > 30.5 ? ['-r', '30'] : [];
    console.log(`encoding ${id}  (${info.width}x${info.height}, ${info.duration.toFixed(1)}s)`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-t', String(SECONDS), '-an', '-vf', vf, ...rate,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-profile:v', 'high', '-movflags', '+faststart', video]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', `${tag}scale=${WIDTH}:-2:flags=lanczos`, '-q:v', '5', poster]);
  }
  const out = probe(video);
  pool.push({
    id, scenario: s.scenario,
    video: `/hero/${id}.mp4`, poster: `/hero/${id}.jpg`,
    width: out.width, height: out.height, seconds: Math.round(out.duration * 10) / 10,
    bytes: statSync(video).size,
    source: { title: s.title, itemUrl: s.itemUrl, license },
  });
}
pool.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(MANIFEST, JSON.stringify(pool, null, 2) + '\n');
const mb = pool.reduce((t, p) => t + p.bytes, 0) / 1e6;
console.log(`wrote ${pool.length} clips (${mb.toFixed(1)} MB) to ${path.relative(ROOT, MANIFEST)}`);
