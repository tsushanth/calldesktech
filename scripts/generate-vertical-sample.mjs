#!/usr/bin/env node
// Generates a recorded, transcribed sample call for one vertical: an AI "shopper" caller phones OUR OWN
// demo agent, which answers as a FICTIONAL business (scripts/sample-scenarios.json). The result is an
// UNPUBLISHED sample that a human reviews. Nothing here ever sends email or publishes by default.
//
// Steps are separate and explicit:
//   node scripts/generate-vertical-sample.mjs --vertical freight --dry-run     # plan + env/config check, no network
//   node scripts/generate-vertical-sample.mjs --vertical freight --place-call  # places ONE real call (costs money), writes out/samples/freight/
//       (without --place-call this is a dry run; hard cap MAX_REAL_CALLS total, tracked in out/.sample-calls-used;
//        callee must be listed in SAMPLE_CALLEE_ALLOWED in .env)
//   node scripts/generate-vertical-sample.mjs --vertical freight --upload      # uploads the local files -> private bucket + unpublished row (no new call)
//   node scripts/generate-vertical-sample.mjs --publish <sample-id>            # flips published=true (unpublishes the product's previous one)
//
// Options: --out <dir> (default out/samples/<vertical>), --callee-number <E.164 of one of OUR OWN tenant
// numbers> (or SAMPLE_CALLEE_NUMBER), --env-file <path> (default ./.env; process.env wins).
// Needs CALL_LOOP_POC_BASE_URL, CALL_LOOP_POC_TEST_CALL_SECRET (call), NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY (transcript fetch, --upload, --publish). Secret values are never printed.
//
// The call requires a call-loop-poc that supports `sampleCallee` (branch outreach-sample-callee in
// realtime-tts). The script probes GET /sample-callee-capability and REFUSES to dial otherwise, because an
// older poc would silently ignore the field and answer with the number's real tenant agent.

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  validateScenarios, normalizeTranscript, buildSampleRow, estimateCostUsd, parseArgs, isE164,
  MAX_REAL_CALLS, parseCounter, checkCallGate, validatePublishable,
} from './lib/sample-lib.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BUCKET = 'outreach-samples';
const MAX_WAIT_MS = 5 * 60_000;
// Persistent real-call counter (git-ignored out/). Incremented the moment the poc returns a call sid.
const COUNTER_FILE = join(ROOT, 'out/.sample-calls-used');
const readCounter = (file = COUNTER_FILE) => parseCounter(existsSync(file) ? readFileSync(file, 'utf8') : null);
function bumpCounter(file = COUNTER_FILE) {
  mkdirSync(dirname(file), { recursive: true });
  const n = readCounter(file) + 1;
  writeFileSync(file, String(n));
  return n;
}

const die = (msg, code = 1) => { console.error(`\nERROR: ${msg}`); process.exit(code); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadEnv(envFile) {
  const path = resolve(envFile || process.env.ENV_FILE || join(ROOT, '.env'));
  const env = {};
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    }
  }
  return { get: (k) => process.env[k] || env[k] || '', path, exists: existsSync(path) };
}

const scenarios = () => {
  const doc = JSON.parse(readFileSync(join(ROOT, 'scripts/sample-scenarios.json'), 'utf8'));
  const errs = validateScenarios(doc);
  if (errs.length) die(`scenario file invalid:\n - ${errs.join('\n - ')}`);
  return doc.scenarios;
};

// ---- Supabase (service role) ---------------------------------------------------------------------
function supa(env) {
  const base = env.get('NEXT_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
  const key = env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key) die('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for this step.');
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  return {
    rest: (path, init = {}) => fetch(`${base}/rest/v1/${path}`, { ...init, headers: { ...h, 'Content-Type': 'application/json', ...(init.headers || {}) } }),
    storage: (path, init = {}) => fetch(`${base}/storage/v1/${path}`, { ...init, headers: { ...h, ...(init.headers || {}) } }),
  };
}

async function requireMigration(db) {
  const r = await db.rest('calldesk_outreach_samples?select=id&limit=1');
  if (r.ok) return;
  const body = await r.text();
  if (/PGRST205|42P01|does not exist|schema cache/i.test(body)) {
    die('table calldesk_outreach_samples does not exist. Migration supabase/migrations/043_outreach_samples.sql has NOT been applied to this database. A human must apply it first; this script will not.');
  }
  die(`could not query calldesk_outreach_samples (HTTP ${r.status}): ${body.slice(0, 200)}`);
}

async function ensureBucket(db) {
  const r = await db.storage(`bucket/${BUCKET}`);
  if (r.ok) {
    const b = await r.json();
    if (b.public) die(`bucket ${BUCKET} exists but is PUBLIC; it must be private. Fix it in the Supabase dashboard.`);
    return;
  }
  const c = await db.storage('bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) });
  if (!c.ok) die(`bucket ${BUCKET} is missing and could not be created (HTTP ${c.status}). Create a PRIVATE bucket named "${BUCKET}" in Supabase Storage, then re-run.`);
  console.log(`created private bucket ${BUCKET}`);
}

// ---- generate -------------------------------------------------------------------------------------
export async function generate(args, env, sc, outDir, counterFile = COUNTER_FILE) {
  const base = env.get('CALL_LOOP_POC_BASE_URL').replace(/\/+$/, '');
  const secret = env.get('CALL_LOOP_POC_TEST_CALL_SECRET');
  const callee = args.calleeNumber || env.get('SAMPLE_CALLEE_NUMBER');
  // Without an explicit --place-call this is always a dry run.
  const dryRun = args.dryRun || !args.placeCall;
  const used = readCounter(counterFile);
  const gate = checkCallGate({ placeCall: true, used, callee, allowedRaw: env.get('SAMPLE_CALLEE_ALLOWED') });

  const problems = [];
  if (!base) problems.push('CALL_LOOP_POC_BASE_URL is not set');
  if (!secret) problems.push('CALL_LOOP_POC_TEST_CALL_SECRET is not set');
  if (!env.get('NEXT_PUBLIC_SUPABASE_URL') || !env.get('SUPABASE_SERVICE_ROLE_KEY')) problems.push('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (transcript is read from the poc call log)');
  problems.push(...gate.reasons);

  console.log(`vertical:        ${sc.id} (${sc.product})`);
  console.log(`fictional biz:   ${sc.businessName}`);
  console.log(`scenario:        ${sc.title}`);
  console.log(`target length:   ${sc.targetSeconds[0]}-${sc.targetSeconds[1]}s (Twilio TimeLimit hard-caps at 150s)`);
  console.log(`callee number:   ${callee || '(unset)'}`);
  console.log(`poc:             ${base || '(unset)'}   env file: ${env.exists ? env.path : '(none)'}`);
  console.log(`output dir:      ${outDir}`);
  console.log(`est. cost:       ~$${estimateCostUsd(sc.targetSeconds[1])} at ${sc.targetSeconds[1]}s (estimate)`);
  console.log(`disclosure:      ${sc.disclosure}`);
  console.log(`real calls used: ${used}/${MAX_REAL_CALLS}`);
  if (problems.length) {
    console.log(`\nprerequisites missing:\n - ${problems.join('\n - ')}`);
    if (!dryRun) die('cannot place the call until these are fixed.');
    return;
  }
  if (dryRun) { console.log('\ndry run: no call placed, nothing written. Add --place-call to dial for real.'); return; }
  if (!gate.ok) die(`refusing to dial: ${gate.reasons.join('; ')}`);
  console.log(`\nabout to dial ${callee} (allow-listed) as the caller persona; call ${used + 1} of ${MAX_REAL_CALLS}.`);

  // Capability probe: refuse to dial a poc that would ignore sampleCallee.
  const cap = await fetch(`${base}/sample-callee-capability`).catch(() => null);
  const capJson = cap && cap.ok ? await cap.json().catch(() => null) : null;
  if (!capJson || !capJson.sampleCallee) {
    die(`the poc at ${base} does not support per-call sampleCallee (probe failed${cap ? `, HTTP ${cap.status}` : ', unreachable'}). Refusing to dial: an older poc would answer with the number's real tenant agent. Deploy branch outreach-sample-callee of realtime-tts first (see the task-4 report for steps).`);
  }

  const auth = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
  console.log('\nplacing call...');
  const placed = await fetch(`${base}/place-test-call`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      toNumber: callee, shopper: true, record: true,
      persona: sc.callerPersona,
      sampleCallee: { systemPrompt: sc.agentPrompt, greeting: sc.greeting, voice: sc.agentVoice, stability: 0.8 },
      shopperVoice: { voice: sc.callerVoice, stability: 0.8 },
    }),
  });
  const pj = await placed.json().catch(() => ({}));
  if (!placed.ok || !pj.sid) die(`place-test-call failed (HTTP ${placed.status}): ${JSON.stringify(pj).slice(0, 300)}`);
  console.log(`real calls used: ${bumpCounter(counterFile)}/${MAX_REAL_CALLS} (counted at dial, even if the call later fails)`);
  if (!pj.sampleCallee) die(`call ${pj.sid} was placed but the poc did not confirm sampleCallee; it may have reached a real tenant agent. Check it in Twilio and discard.`);
  const sid = pj.sid;
  console.log(`call sid: ${sid}`);

  // Wait for completion.
  const t0 = Date.now();
  let status = pj.status, duration = 0;
  while (Date.now() - t0 < MAX_WAIT_MS) {
    await sleep(5000);
    const s = await fetch(`${base}/call-status/${sid}`, { headers: auth }).then((r) => r.json()).catch(() => ({}));
    status = s.status || status; duration = s.duration || duration;
    if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(status)) break;
  }
  if (status !== 'completed') die(`call ended in status "${status}" (sid ${sid}); no sample produced.`);
  console.log(`completed, ${duration}s`);

  mkdirSync(outDir, { recursive: true });

  // Recording: copy out of Twilio (retention sweep deletes it).
  let audioFile = null, recMeta = null;
  for (let i = 0; i < 24; i++) {
    recMeta = await fetch(`${base}/call-recording/${sid}`, { headers: auth }).then((r) => r.json()).catch(() => null);
    if (recMeta && recMeta.url && recMeta.status === 'completed') break;
    await sleep(5000);
  }
  if (recMeta && recMeta.url && recMeta.status === 'completed') {
    const a = await fetch(`${base}/recording-audio?url=${encodeURIComponent(recMeta.url)}`, { headers: { Authorization: `Bearer ${secret}` } });
    if (a.ok) {
      audioFile = 'audio.mp3';
      writeFileSync(join(outDir, audioFile), Buffer.from(await a.arrayBuffer()));
      // Twilio's dual-channel file hard-pans each speaker with unequal levels and digital silence between turns.
      // Level-match both legs, fold to mono, and add a faint noise bed so pauses read as a phone line, not gaps.
      try {
        const src = join(outDir, audioFile), tmp = join(outDir, 'audio.processed.mp3');
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-filter_complex',
          '[0:a]channelsplit=channel_layout=stereo[l][r];[l]loudnorm=I=-19:TP=-2[ln];[r]loudnorm=I=-19:TP=-2[rn];' +
          '[ln][rn]amix=inputs=2:normalize=0[m];anoisesrc=color=pink:amplitude=0.0015:sample_rate=22050[n];' +
          '[m][n]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.9[o]', '-map', '[o]', '-ac', '1', '-b:a', '96k', tmp]);
        renameSync(src, join(outDir, 'audio.original.mp3'));
        renameSync(tmp, src);
      } catch (e) { console.warn(`WARNING: audio cleanup skipped (${e.message.split('\n')[0]}); keeping the raw recording.`); }
    } else console.warn(`WARNING: recording download failed (HTTP ${a.status})`);
  } else console.warn('WARNING: no completed recording found; audio missing.');

  // Transcript from the shopper's call-log row (retell_call_id = CallSid).
  const db = supa(env);
  let raw = null;
  for (let i = 0; i < 12 && !raw; i++) {
    const r = await db.rest(`calldesk_call_logs?retell_call_id=eq.${sid}&select=transcript,duration_seconds&limit=1`);
    const rows = r.ok ? await r.json() : [];
    raw = rows[0]?.transcript && rows[0].transcript.length ? rows[0].transcript : null;
    if (!raw) await sleep(5000);
  }
  if (!raw) die(`no transcript found in calldesk_call_logs for ${sid} (the poc only logs when the dialed number belongs to a tenant). Audio ${audioFile ? 'saved' : 'missing'} in ${outDir}.`);
  writeFileSync(join(outDir, 'transcript.raw.json'), JSON.stringify(raw, null, 2));
  finishLocal(outDir, sc, raw, { sid, duration, audioFile, recording: recMeta && { status: recMeta.status, channels: recMeta.channels } });
}

function finishLocal(outDir, sc, raw, meta) {
  const transcript = normalizeTranscript(raw, { shopperPerspective: true });
  const row = buildSampleRow({ scenario: sc, transcript, audioPath: null, durationSec: meta.duration });
  writeFileSync(join(outDir, 'transcript.json'), JSON.stringify(transcript, null, 2));
  writeFileSync(join(outDir, 'sample-row.json'), JSON.stringify(row, null, 2));
  writeFileSync(join(outDir, 'call-meta.json'), JSON.stringify({ ...meta, vertical: sc.id, estimatedCostUsd: estimateCostUsd(meta.duration), generatedAt: new Date().toISOString() }, null, 2));
  console.log(`\nwrote ${outDir}: ${transcript.length} transcript lines, snippet indexes [${row.snippet.join(', ')}]`);
  console.log('REVIEW audio + transcript (check names, accuracy, tone) before --upload / --publish. Speaker labels assume the shopper-side log: assistant=caller, user=agent.');
}

// ---- upload / publish -----------------------------------------------------------------------------
async function upload(args, env, sc, outDir) {
  const rowPath = join(outDir, 'sample-row.json');
  if (!existsSync(rowPath)) die(`${rowPath} not found; generate the sample first (no call is placed by --upload).`);
  const row = JSON.parse(readFileSync(rowPath, 'utf8'));
  if (row.product !== sc.product) die(`local sample is for ${row.product}, not ${sc.product}`);
  const audioPath = join(outDir, 'audio.mp3');
  if (!existsSync(audioPath)) die(`${audioPath} not found; a sample without audio cannot be uploaded.`);
  const db = supa(env);
  await requireMigration(db);
  await ensureBucket(db);
  const key = `${sc.id}/${Date.now()}.mp3`;
  const up = await db.storage(`object/${BUCKET}/${key}`, { method: 'POST', headers: { 'Content-Type': 'audio/mpeg', 'x-upsert': 'false' }, body: readFileSync(audioPath) });
  if (!up.ok) die(`audio upload failed (HTTP ${up.status}): ${(await up.text()).slice(0, 200)}`);
  const ins = await db.rest('calldesk_outreach_samples', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...row, audio_path: key, published: false }) });
  if (!ins.ok) die(`row insert failed (HTTP ${ins.status}): ${(await ins.text()).slice(0, 300)} (audio remains at ${BUCKET}/${key})`);
  const [created] = await ins.json();
  console.log(`uploaded ${BUCKET}/${key}\ninserted UNPUBLISHED sample ${created.id}\nafter human review: node scripts/generate-vertical-sample.mjs --publish ${created.id}`);
}

async function publish(id, env) {
  const db = supa(env);
  await requireMigration(db);
  const one = await db.rest(`calldesk_outreach_samples?id=eq.${id}&select=id,product,audio_path,transcript,snippet`);
  const rows = one.ok ? await one.json() : [];
  if (!rows.length) die(`no sample with id ${id}`);
  const errs = validatePublishable(rows[0]);
  if (errs.length) die(`refusing to publish ${id}:\n - ${errs.join('\n - ')}`);
  // Atomic swap in one DB transaction (function defined in migration 043; if missing, apply the migration).
  const r = await db.rest('rpc/calldesk_publish_outreach_sample', { method: 'POST', body: JSON.stringify({ p_sample_id: id }) });
  if (!r.ok) die(`publish failed (HTTP ${r.status}): ${(await r.text()).slice(0, 400)}. Nothing was changed by this call.`);
  console.log(`published ${id} for ${rows[0].product} (previous published sample, if any, was unpublished in the same transaction)`);
}

// ---- main -----------------------------------------------------------------------------------------
async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { die(`${e.message}\nusage: node scripts/generate-vertical-sample.mjs --vertical <id> [--dry-run] [--out <dir>] [--callee-number <E.164>] [--upload]\n       node scripts/generate-vertical-sample.mjs --publish <sample-id>`); }
  if (args.help) { console.log('see header comment of scripts/generate-vertical-sample.mjs'); return; }
  const env = loadEnv(args.envFile);
  if (args.publish) return publish(args.publish, env);
  const sc = scenarios().find((s) => s.id === args.vertical);
  const outDir = resolve(args.out || join(ROOT, 'out/samples', sc.id));
  if (args.upload) return upload(args, env, sc, outDir);
  return generate(args, env, sc, outDir);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => die(e && e.message ? e.message : String(e)));
}
