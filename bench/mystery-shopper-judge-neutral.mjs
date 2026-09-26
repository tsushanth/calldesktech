// Blind A/B judge — neutral version.
// Accepts generic --a / --b with custom labels, so the same judge works for
// any pair of backends (Calldesk vs Retell, Calldesk vs ThunderPhone, etc.).
//
// Runs via the `claude` CLI (OAuth session auth) per repo policy — do NOT burn
// ANTHROPIC_API_KEY on one-off local analysis.
//
// Usage:
//   node mystery-shopper-judge-neutral.mjs \
//     --a transcript-a.txt --label-a "Calldesk" \
//     --b transcript-b.txt --label-b "ThunderPhone" \
//     [--metrics-a a.json] [--metrics-b b.json]

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

const aPath = arg('a');
const bPath = arg('b');
const labelA = arg('label-a') || 'System A';
const labelB = arg('label-b') || 'System B';

if (!aPath || !bPath) {
  console.error('usage: node mystery-shopper-judge-neutral.mjs --a <file> --b <file> [--label-a <name>] [--label-b <name>] [--metrics-a <json>] [--metrics-b <json>]');
  process.exit(1);
}

const aTranscript = fs.readFileSync(aPath, 'utf8');
const bTranscript = fs.readFileSync(bPath, 'utf8');

function readMetrics(path) {
  if (!path || !fs.existsSync(path)) return null;
  try {
    return JSON.stringify(JSON.parse(fs.readFileSync(path, 'utf8')), null, 2);
  } catch {
    console.warn(`[judge] could not parse metrics file ${path} — judging on transcripts only`);
    return null;
  }
}

const aMetrics = readMetrics(arg('metrics-a'));
const bMetrics = readMetrics(arg('metrics-b'));

const aIsFirst = Math.random() < 0.5;
const [firstLabel, secondLabel] = aIsFirst ? [labelA, labelB] : [labelB, labelA];
const [firstTranscript, secondTranscript] = aIsFirst ? [aTranscript, bTranscript] : [bTranscript, aTranscript];
const [firstMetrics, secondMetrics] = aIsFirst ? [aMetrics, bMetrics] : [bMetrics, aMetrics];

function metricsSection(metrics) {
  if (!metrics) return '(no timing metrics were provided for this call — score the transcript alone.)';
  return metrics;
}

const PROMPT = `You are an expert voice-AI conversation quality judge. You will be shown two
real phone call transcripts, "Call A" and "Call B", both of the SAME customer
persona/goal calling two different backend implementations of a booking
assistant. You do not know which is which — score them purely on the
transcript content, blind.

Score each call 1-5 (5 = best) on:
1. Turn efficiency — fewer unnecessary back-and-forths to complete the task
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
   the agent starting to respond; smaller is better. Flag egregious outliers.

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

const result = spawnSync('claude', ['-p', '--output-format', 'text'], {
  input: PROMPT,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});

if (result.status !== 0) {
  console.error('claude CLI failed:', result.stderr);
  process.exit(1);
}

console.log(result.stdout);
console.log('\n\n=== DE-ANONYMIZED ===');
console.log(`Call A = ${firstLabel}`);
console.log(`Call B = ${secondLabel}`);

const winnerMatch = result.stdout.match(/Winner:\s*\*{0,2}([AB])\b/i);
const winnerLabel = winnerMatch ? { A: firstLabel, B: secondLabel }[winnerMatch[1].toUpperCase()] : null;
console.log(`WINNER_SYSTEM: ${winnerLabel || 'unknown'}`);
