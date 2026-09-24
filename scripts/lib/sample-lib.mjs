// Pure helpers for scripts/generate-vertical-sample.mjs (no I/O, unit-tested in test/lib/sampleGeneration.test.ts).

export const VERTICALS = ['freight', 'homeservices', 'dental', 'insurance', 'towing', 'septic', 'homecare', 'bailbonds'];
// HARD CAP on real sample calls for this task. Deliberately a constant, not a flag: raising it means
// editing this line (or the counter file out/.sample-calls-used) on purpose.
export const MAX_REAL_CALLS = 2;
export const SNIPPET_MIN = 4;
export const SNIPPET_MAX = 6;
// Rough cost model (estimate only, see task-4 report): our engine ~$0.044/min per AI session (two sessions:
// shopper + demo agent) plus Twilio voice for the two legs (~$0.0140/min each, US).
export const COST_PER_MIN = { engine: 0.044, sessions: 2, twilioLegs: 2, twilioPerLegMin: 0.014 };

/** Returns an array of error strings; empty means valid. */
export function validateScenarios(doc) {
  const errs = [];
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.scenarios)) return ['root must be {scenarios: []}'];
  const seen = new Set();
  for (const s of doc.scenarios) {
    const id = s && s.id;
    const at = `scenario ${id || '?'}`;
    if (!VERTICALS.includes(id)) errs.push(`${at}: id must be one of ${VERTICALS.join(', ')}`);
    if (seen.has(id)) errs.push(`${at}: duplicate id`);
    seen.add(id);
    if (s.product !== `calldesk:${id}`) errs.push(`${at}: product must be "calldesk:${id}"`);
    for (const f of ['title', 'businessName', 'disclosure', 'greeting', 'agentPrompt', 'callerPersona']) {
      if (typeof s[f] !== 'string' || !s[f].trim()) errs.push(`${at}: ${f} must be a non-empty string`);
    }
    // Limits mirror the poc's parseSampleCallee + shopper persona cap.
    if (typeof s.agentPrompt === 'string' && (s.agentPrompt.length < 20 || s.agentPrompt.length > 6000)) errs.push(`${at}: agentPrompt must be 20-6000 chars`);
    if (typeof s.greeting === 'string' && s.greeting.length > 400) errs.push(`${at}: greeting must be <= 400 chars`);
    if (typeof s.callerPersona === 'string' && s.callerPersona.length > 2000) errs.push(`${at}: callerPersona must be <= 2000 chars`);
    if (typeof s.greeting === 'string' && !(/\bAI\b/.test(s.greeting) && /\b(demo|fictional)\b/i.test(s.greeting))) errs.push(`${at}: greeting must state spoken disclosure (an AI demo call / fictional business)`);
    if (typeof s.disclosure === 'string' && !/\bAI\b/.test(s.disclosure)) errs.push(`${at}: disclosure must state it is an AI call`);
    const blob = [s.agentPrompt, s.callerPersona, s.greeting].join(' ');
    if (/\+?\d{3}[\s.-]\d{3}[\s.-]\d{4}/.test(blob) || /@\w+\.\w+/.test(blob)) errs.push(`${at}: contains a phone number or email address`);
    if (!Array.isArray(s.targetSeconds) || s.targetSeconds.length !== 2) errs.push(`${at}: targetSeconds must be [min,max]`);
  }
  for (const v of VERTICALS) if (!seen.has(v)) errs.push(`missing vertical ${v}`);
  return errs;
}

const SYSTEM_MARKER_RE = /^\s*\[(?:call connected|the call just connected|tone:)[^\]]*\]\s*/i; // [tone:..] is stripped by cleanText, the others drop the line

function cleanText(t) {
  return String(t ?? '').replace(/^\s*\[tone:[^\]]*\]\s*/i, '').replace(/\s+/g, ' ').trim();
}

/**
 * Normalize the poc's stored transcript ([{role:'user'|'assistant', content}]) into [{speaker, text}].
 * The row we read is the SHOPPER's own session: role 'assistant' = the shopper (our 'caller'),
 * role 'user' = what the shopper heard = the demo agent. Pass shopperPerspective:false to invert.
 * Accepts already-normalized {speaker,text} rows too. Drops empty/system-marker lines and merges
 * consecutive same-speaker lines.
 */
export function normalizeTranscript(rows, { shopperPerspective = true } = {}) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    let speaker;
    if (r.speaker === 'caller' || r.speaker === 'agent') speaker = r.speaker;
    else if (r.role === 'assistant') speaker = shopperPerspective ? 'caller' : 'agent';
    else if (r.role === 'user') speaker = shopperPerspective ? 'agent' : 'caller';
    else continue;
    const raw = r.text ?? r.content;
    if (typeof raw !== 'string' || SYSTEM_MARKER_RE.test(raw) && !/^\s*\[tone:/i.test(raw)) continue;
    const text = cleanText(raw);
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.speaker === speaker) last.text = `${last.text} ${text}`;
    else out.push({ speaker, text });
  }
  return out;
}

const ACTION_RE = /\b(book(ed|ing)?|schedul(e|ed|ing)|dispatch(ed|ing)?|transfer(ring|red)?|call(ing)? you back|call you|callback|reach out|follow up|send(ing)?|take a message|passed? (it|that) (on|along)|on[- ]call|page|eta|minutes|noted|i('ve| have) (got|added|put|marked|noted)|confirm(ed)?)\b/i;
const MAX_SNIPPET_LINE = 170;

/**
 * Deterministic 4-6 line snippet: the greeting, the caller's need, and a concrete agent action with
 * the exchange around it. Returns ascending unique transcript indexes ([] if the transcript is too short).
 */
export function pickSnippet(transcript) {
  const t = Array.isArray(transcript) ? transcript : [];
  if (t.length < SNIPPET_MIN) return [];
  const short = (i) => t[i] && t[i].text.length <= MAX_SNIPPET_LINE;
  const picked = new Set();
  const firstAgent = t.findIndex((l) => l.speaker === 'agent');
  const start = firstAgent === -1 ? 0 : firstAgent;
  picked.add(start);
  const need = t.findIndex((l, i) => i > start && l.speaker === 'caller');
  if (need !== -1) picked.add(need);
  // Concrete agent action: first later agent line matching an action verb, preferring short lines.
  const from = need === -1 ? start + 1 : need + 1;
  let action = -1;
  for (let i = from; i < t.length; i++) {
    if (t[i].speaker === 'agent' && ACTION_RE.test(t[i].text) && t[i].text.length >= 25 && short(i)) { action = i; break; }
  }
  if (action === -1) for (let i = from; i < t.length; i++) if (t[i].speaker === 'agent' && ACTION_RE.test(t[i].text)) { action = i; break; }
  if (action === -1) action = Math.min(t.length - 1, from);
  // Prefer to include the caller line just before the action and the caller reply just after.
  if (action - 1 > start && t[action - 1].speaker === 'caller') picked.add(action - 1);
  picked.add(action);
  if (action + 1 < t.length && t[action + 1].speaker === 'caller') picked.add(action + 1);
  // Pad to the minimum with the lines that follow the last picked index, then trim to the max.
  for (let i = start + 1; picked.size < SNIPPET_MIN && i < t.length; i++) picked.add(i);
  let idx = [...picked].sort((a, b) => a - b);
  while (idx.length > SNIPPET_MAX) idx.splice(idx[idx.length - 1] === action ? 1 : idx.length - 1, 1);
  return idx;
}

export function estimateCostUsd(durationSec) {
  const min = Math.max(0, durationSec) / 60;
  const c = COST_PER_MIN;
  return Math.round(min * (c.engine * c.sessions + c.twilioLegs * c.twilioPerLegMin) * 1000) / 1000;
}

/** Row for calldesk_outreach_samples, matching migration 043 (published is always false here). */
export function buildSampleRow({ scenario, transcript, audioPath, durationSec }) {
  return {
    product: scenario.product,
    title: scenario.title,
    business_name: scenario.businessName,
    disclosure: scenario.disclosure,
    audio_path: audioPath ?? null,
    audio_duration_sec: Number.isFinite(durationSec) ? Math.round(durationSec) : null,
    transcript,
    snippet: pickSnippet(transcript),
    published: false,
  };
}

export function parseArgs(argv) {
  const o = { vertical: null, dryRun: false, out: null, upload: false, publish: null, calleeNumber: null, envFile: null, help: false, placeCall: false };
  const need = (i, name) => {
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`${name} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vertical') { o.vertical = need(i, a); i++; }
    else if (a === '--out') { o.out = need(i, a); i++; }
    else if (a === '--publish') { o.publish = need(i, a); i++; }
    else if (a === '--callee-number') { o.calleeNumber = need(i, a); i++; }
    else if (a === '--env-file') { o.envFile = need(i, a); i++; }
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--upload') o.upload = true;
    else if (a === '--place-call') o.placeCall = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (o.publish && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(o.publish)) throw new Error('--publish needs a sample id (uuid)');
  if (o.publish && (o.upload || o.dryRun)) throw new Error('--publish is a separate step: do not combine with --upload/--dry-run');
  if (!o.help && !o.publish && !o.vertical) throw new Error('--vertical is required');
  if (o.vertical && !VERTICALS.includes(o.vertical)) throw new Error(`unknown vertical "${o.vertical}" (one of ${VERTICALS.join(', ')})`);
  return o;
}

export const isE164 = (n) => typeof n === 'string' && /^\+[1-9]\d{7,14}$/.test(n);

export function parseAllowed(raw) {
  return String(raw || '').split(',').map((x) => x.trim()).filter(Boolean);
}

/** Counter file content -> number of calls already placed (garbage counts as the cap: fail closed). */
export function parseCounter(text) {
  if (text == null) return 0;
  const n = Number(String(text).trim());
  return Number.isInteger(n) && n >= 0 ? n : MAX_REAL_CALLS;
}

/**
 * Pure gate for dialing. Returns {ok, reasons}. Dials only with an explicit --place-call, under the
 * cap, and to a number a human listed in SAMPLE_CALLEE_ALLOWED.
 */
export function checkCallGate({ placeCall, used, callee, allowedRaw, max = MAX_REAL_CALLS }) {
  const reasons = [];
  if (!placeCall) reasons.push('--place-call not given (without it this is a dry run)');
  if (used >= max) reasons.push(`real-call cap reached (${used}/${max} used; cap is MAX_REAL_CALLS in scripts/lib/sample-lib.mjs)`);
  const allowed = parseAllowed(allowedRaw);
  if (!callee || !isE164(callee)) reasons.push('callee number missing (--callee-number or SAMPLE_CALLEE_NUMBER) or not E.164');
  else if (!allowed.includes(callee)) reasons.push('callee number is not in SAMPLE_CALLEE_ALLOWED (a human must list our own numbers there)');
  return { ok: reasons.length === 0, reasons };
}

/** Errors that block publishing a sample row (mirrors the checks inside calldesk_publish_outreach_sample). */
export function validatePublishable(row) {
  const errs = [];
  if (!row || typeof row !== 'object') return ['sample not found'];
  if (typeof row.audio_path !== 'string' || !row.audio_path.trim()) errs.push('audio_path is not set');
  const t = row.transcript;
  if (!Array.isArray(t) || t.length < SNIPPET_MIN) errs.push(`transcript needs at least ${SNIPPET_MIN} lines`);
  const sn = row.snippet;
  if (!Array.isArray(sn) || sn.length === 0) errs.push('snippet is empty');
  else if (Array.isArray(t) && !sn.every((i) => Number.isInteger(i) && i >= 0 && i < t.length)) errs.push('snippet has indexes outside the transcript');
  return errs;
}
