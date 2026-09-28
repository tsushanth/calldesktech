// Blind judge — neutral, model-pinned, and reusable for any pair of backends.
//
// ADDITIVE. Sits alongside `mystery-shopper-judge-neutral.mjs` rather than
// replacing it. Same --a/--b interface and same seven criteria, so scores stay
// comparable with the published 2026-09-21 / 2026-09-26 runs. Three additions:
//
//   1. --critique mode scores ONE transcript on its own. A comparative judge
//      can only report gaps on the loser, so a clean sweep yields no work —
//      exactly when a second opinion matters most.
//   2. The judge model is pinned and echoed as `JUDGE_MODEL:`, so a published
//      report can state what scored it. The unpinned `claude -p`
//      session-default path is opt-in via --use-cli only; a model that varies
//      by machine and session cannot be reproduced or cited.
//   3. Anti-anchoring guards: a scripted customer turn is never charged to the
//      system under test, and neither system gets credit for sounding more
//      elaborate. An unfilled template placeholder is scored as a correctness
//      failure, not a style nit.
//
// Two modes:
//
//   A/B (default)  — two transcripts, one winner, gaps scored on the loser.
//   --critique     — ONE transcript, scored on its own, with actionable fixes.
//                    Use this on our own calls every round, so a win still
//                    produces work to do.
//
// Usage (A/B):
//   node mystery-shopper-judge-neutral.mjs \
//     --a transcript-a.txt --label-a "Calldesk" \
//     --b transcript-b.txt --label-b "ThunderPhone" \
//     [--metrics-a a.json] [--metrics-b b.json] [--model claude-sonnet-4-6]
//
// Usage (single-system critique):
//   node mystery-shopper-judge-neutral.mjs \
//     --critique transcript.txt --critique-label "Calldesk" \
//     [--metrics a.json]

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

const aPath = arg('a');
const bPath = arg('b');
const labelA = arg('label-a') || 'System A';
const labelB = arg('label-b') || 'System B';
const critiquePath = arg('critique');
const critiqueLabel = arg('critique-label') || 'the system under test';
const critiqueMetrics = arg('metrics');
const metricsAPath = arg('metrics-a');
const metricsBPath = arg('metrics-b');

const CRITIQUE_MODE = Boolean(critiquePath);
if (!CRITIQUE_MODE && (!aPath || !bPath)) {
  console.error(
    'usage: node mystery-shopper-judge-neutral.mjs --a <file> --b <file> [--label-a <name>] [--label-b <name>] [--metrics-a <json>] [--metrics-b <json>]\n' +
    '   or: node mystery-shopper-judge-neutral.mjs --critique <file> [--critique-label <name>] [--metrics <json>]',
  );
  process.exit(1);
}

const JUDGE_MODEL = arg('model') || 'claude-sonnet-4-6';
const USE_CLI = flag('use-cli');
const THINKING = flag('thinking');
const THINKING_BUDGET = Number(arg('thinking-budget') || 4096);

// --- inputs ----------------------------------------------------------------

function readMetrics(path) {
  if (!path || !fs.existsSync(path)) return null;
  try {
    return JSON.stringify(JSON.parse(fs.readFileSync(path, 'utf8')), null, 2);
  } catch {
    console.warn(`[judge] could not parse metrics file ${path} — judging on transcripts only`);
    return null;
  }
}

function metricsSection(metrics) {
  if (!metrics) return '(no timing metrics were provided for this call — score the transcript alone.)';
  return metrics;
}

const CRITERIA = `1. Turn efficiency — fewer unnecessary back-and-forths to complete the task
2. Naturalness — does it sound like a real conversation, not a form to fill out
3. Slot-filling design — does it ask for related info together sensibly, or
   split things awkwardly across turns
4. Error recovery / confirmation — does it verify captured info (names,
   times) before committing, and handle correction gracefully if needed
5. Closing quality — a clean, confident single closing vs. a disjointed
   multi-beat wrap-up
6. Any awkward or robotic-sounding phrasing (quote it if present)

If "timing metrics" sections were provided for a call, also factor them in
(they are real, measured numbers, not impressions):
7. Response latency — median/max time from the customer finishing speaking to
   the agent starting to respond; smaller is better. Flag egregious outliers.`;

// Guards added after the first published run. Both are about not letting the
// judge's own failure modes decide a round:
//   - a customer utterance that is itself incoherent must not be charged to
//     the system under test (this cost a real round in the 2026-09-21 run)
//   - neither system gets credit for sounding more elaborate
const GUARDS = `Before scoring, apply these rules:

- The customer side is scripted and may itself mishear, contradict itself, or
  invent detail. Do NOT charge the system under test for a defect in the
  customer turn. If the customer says something incoherent, score the system
  on how it handled it and say so explicitly.
- Do not prefer a system for sounding more elaborate, more technical, or more
  fluent-sounding. Score only what the caller experiences on the call.
- An unfilled template placeholder (e.g. a literal "My name is [Your Name]")
  is a correctness failure, not a style issue. It always costs points under
  error recovery and closing quality.
- A slot that was never captured, or captured wrong and not corrected, is the
  most serious possible failure in a booking call. Weigh it accordingly.`;

const SCORED_FORMAT = (label) => `## ${label}
- Turn efficiency: X/5 — reasoning
- Naturalness: X/5 — reasoning
- Slot-filling design: X/5 — reasoning
- Error recovery: X/5 — reasoning
- Closing quality: X/5 — reasoning
- Awkward phrasing: [quote or "none noted"]
- Response latency: X/5 — reasoning (only if timing metrics were provided)`;

let prompt;
if (CRITIQUE_MODE) {
  const transcript = fs.readFileSync(critiquePath, 'utf8');
  const metrics = readMetrics(critiqueMetrics);
  prompt = `You are an expert voice-AI conversation quality judge. You are auditing a
single real phone call transcript. Unlike a comparison, you are looking only
for what should be fixed — including problems that a head-to-head win would
hide.

Score the call 1-5 (5 = best) on:

${CRITERIA}

${GUARDS}

Then report, in this exact structure:

${SCORED_FORMAT('Call')}

## Verdict
Overall: X/5 — one-paragraph justification
Task completed: yes / partially / no — was the caller's actual goal achieved?

## What to fix
Order these by how much they cost you in real deployments. Each must be
CONCRETE and ACTIONABLE, specific enough to hand straight to an engineer
(e.g. "require the caller to spell the name before accepting it" not "improve
name capture"). Include the failure you observed, not a hypothetical.

1. ...
2. ...
3. ...
4. ...

## Transcript
${transcript}

## Timing metrics
${metricsSection(metrics)}
`;
} else {
  const aTranscript = fs.readFileSync(aPath, 'utf8');
  const bTranscript = fs.readFileSync(bPath, 'utf8');
  const aMetrics = readMetrics(metricsAPath);
  const bMetrics = readMetrics(metricsBPath);

  const aIsFirst = Math.random() < 0.5;
  const [firstLabel, secondLabel] = aIsFirst ? [labelA, labelB] : [labelB, labelA];
  const [firstTranscript, secondTranscript] = aIsFirst ? [aTranscript, bTranscript] : [bTranscript, aTranscript];
  const [firstMetrics, secondMetrics] = aIsFirst ? [aMetrics, bMetrics] : [bMetrics, aMetrics];

  prompt = `You are an expert voice-AI conversation quality judge. You will be shown two
real phone call transcripts, "Call A" and "Call B", both of the SAME customer
persona/goal calling two different backend implementations of a booking
assistant. You do not know which is which — score them purely on the
transcript content, blind.

Score each call 1-5 (5 = best) on:

${CRITERIA}

${GUARDS}

Then give an overall winner (A, B, or tie) with a one-paragraph justification,
and 2-4 CONCRETE, ACTIONABLE suggestions for how the worse-performing call's
system could be improved to close the gap — specific enough to hand directly
to an engineer (e.g. "combine the name and time ask into one question" not
"be more efficient").

Respond in this exact structure:

## Call A
- Turn efficiency: X/5 — reasoning
- Naturalness: X/5 — reasoning
- Slot-filling design: X/5 — reasoning
- Error recovery: X/5 — reasoning
- Closing quality: X/5 — reasoning
- Awkward phrasing: [quote or "none noted"]
- Response latency: X/5 — reasoning (only if timing metrics were provided)

## Call B
(same structure)

## Verdict
Winner: A / B / tie
Justification: ...

## Suggestions to close the gap
1. ...
2. ...

## Call A transcript
${firstTranscript}

## Call A timing metrics
${metricsSection(firstMetrics)}

## Call B transcript
${secondTranscript}

## Call B timing metrics
${metricsSection(secondMetrics)}
`;

  globalThis.__abLabels = { firstLabel, secondLabel };
}

// --- model invocation ------------------------------------------------------

// Precedence: $ANTHROPIC_API_KEY, then $CALL_LOOP_ENV, then the historical
// hardcoded location. The old path is a last resort, not the first try, so a
// third party running this repo can point at their own .env.
function readApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const candidates = [
    process.env.CALL_LOOP_ENV,
    join(homedir(), 'Documents/GitHub/realtime-tts/call-loop-poc/.env'),
  ].filter(Boolean);
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const txt = fs.readFileSync(envPath, 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^ANTHROPIC_API_KEY=["']?(.*)["']?\s*$/);
      if (m) return m[1].trim();
    }
  }
  return null;
}

async function callAnthropicApi(prompt) {
  const key = readApiKey();
  if (!key) throw new Error('ANTHROPIC_API_KEY not found (set it directly or via CALL_LOOP_ENV)');
  const body = {
    model: JUDGE_MODEL,
    max_tokens: THINKING ? THINKING_BUDGET + 4096 : 4096,
    messages: [{ role: 'user', content: prompt }],
  };
  if (THINKING) {
    // Extended thinking: matches the "extra intelligence" tier shape we are
    // being compared against, so the judge is not the weak link in the eval.
    body.thinking = { type: 'enabled', budget_tokens: THINKING_BUDGET };
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Anthropic API error: ${err}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return { text, resolvedModel: data.model || JUDGE_MODEL };
}

function tryClaudeCli() {
  const argv = ['-p', '--model', JUDGE_MODEL, '--output-format', 'text'];
  if (THINKING) argv.splice(2, 0, '--thinking');
  const result = spawnSync('claude', argv, {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 300_000,
  });
  if (result.status !== 0 || !result.stdout || !result.stdout.trim()) {
    return { ok: false, error: result.stderr || 'empty output' };
  }
  return { ok: true, text: result.stdout, resolvedModel: JUDGE_MODEL };
}

let text;
let resolvedModel;
if (USE_CLI) {
  const cliResult = tryClaudeCli();
  if (cliResult.ok) {
    text = cliResult.text;
    resolvedModel = cliResult.resolvedModel;
    console.error(`[judge] used claude CLI (model pinned to ${resolvedModel})`);
  } else {
    console.error('[judge] claude CLI failed, falling back to API:', cliResult.error);
    ({ text, resolvedModel } = await callAnthropicApi(prompt));
  }
} else {
  ({ text, resolvedModel } = await callAnthropicApi(prompt));
  console.error(`[judge] used Anthropic API (model ${resolvedModel})`);
}

console.log(text);

const countActionableFixes = (report) => {
  const fixSection = report.split(/^#{1,6}\s*what to fix\b/im)[1] || report;
  return (fixSection.match(/^[ \t]*(?:[-*+][ \t]*)?\*{0,2}[ \t]*\d+\.[ \t]+\S.*$/gim) || []).length;
};

if (CRITIQUE_MODE) {
  console.log('\n\n=== SINGLE-SYSTEM CRITIQUE ===');
  console.log(`System: ${critiqueLabel}`);
  console.log(`ACTIONABLE_FIXES: ${countActionableFixes(text)}`);
} else {
  const { firstLabel, secondLabel } = globalThis.__abLabels;
  console.log('\n\n=== DE-ANONYMIZED ===');
  console.log(`Call A = ${firstLabel}`);
  console.log(`Call B = ${secondLabel}`);
  const winnerMatch = text.match(/Winner:\s*\*{0,2}([AB])\b/i);
  const winnerLabel = winnerMatch ? { A: firstLabel, B: secondLabel }[winnerMatch[1].toUpperCase()] : null;
  console.log(`WINNER_SYSTEM: ${winnerLabel || 'unknown'}`);
}

// Recorded in every verdict file so a published report can state the exact
// judge model, mode and thinking setting that produced the score.
console.log(`JUDGE_MODEL: ${resolvedModel}`);
console.log(`JUDGE_MODE: ${CRITIQUE_MODE ? 'critique' : 'ab'}`);
console.log(`JUDGE_THINKING: ${THINKING ? THINKING_BUDGET : 'off'}`);
