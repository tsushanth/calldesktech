// Blind A/B judge — local Ollama on Mac Mini (free, no rate limits).
// Falls back to Groq, then Anthropic if local model is down.
//
// Setup on Mac Mini:
//   curl -fsSL https://ollama.com/install.sh | sh
//   ollama pull llama3.1:8b   # or llama3.1:70b for better quality
//   ollama serve &
//
// Usage:
//   OLLAMA_URL=http://mac-mini.local:11434 node mystery-shopper-judge-local.mjs \
//     --a transcript-a.txt --label-a Calldesk --b transcript-b.txt --label-b ThunderPhone

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

const aPath = arg('a');
const bPath = arg('b');
const labelA = arg('label-a') || 'System A';
const labelB = arg('label-b') || 'System B';

if (!aPath || !bPath) {
  console.error('usage: node mystery-shopper-judge-local.mjs --a <file> --b <file> [--label-a <name>] [--label-b <name>] [--metrics-a <json>] [--metrics-b <json>]');
  process.exit(1);
}

const aTranscript = fs.readFileSync(aPath, 'utf8');
const bTranscript = fs.readFileSync(bPath, 'utf8');

function readMetrics(path) {
  if (!path || !fs.existsSync(path)) return null;
  try {
    return JSON.stringify(JSON.parse(fs.readFileSync(path, 'utf8')), null, 2);
  } catch {
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

const PROMPT = `You are an expert voice-AI conversation quality judge. You will be shown two real phone call transcripts, "Call A" and "Call B", both of the SAME customer persona/goal calling two different backend implementations of a booking assistant. Score them purely on the transcript content, blind.

Score each call 1-5 (5 = best) on:
1. Turn efficiency — fewer unnecessary back-and-forths to complete the task
2. Naturalness — does it sound like a real conversation, not a form to fill out
3. Slot-filling design — does it ask for related info together sensibly, or split things awkwardly across turns
4. Error recovery / confirmation — does it verify captured info before committing, and handle correction gracefully if needed
5. Closing quality — a clean, confident single closing vs. a disjointed multi-beat wrap-up
6. Any awkward or robotic-sounding phrasing (quote it if present)
7. Response latency — smaller median/max is better. Flag egregious outliers. (only if timing metrics were provided)

Then give an overall winner (A, B, or tie) with a one-paragraph justification, and 2-4 CONCRETE, ACTIONABLE suggestions for how the worse-performing call's system could be improved.

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
${metricsSection(secondMetrics)}`;

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

function readEnvKey(service) {
  const envPath = join(homedir(), 'Documents/GitHub/realtime-tts/call-loop-poc/.env');
  if (!fs.existsSync(envPath)) return process.env[`${service.toUpperCase()}_API_KEY`] || null;
  const txt = fs.readFileSync(envPath, 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(new RegExp(`^${service.toUpperCase()}_API_KEY=["']?(.*)["']?\\s*$`, 'i'));
    if (m) return m[1].trim();
  }
  return process.env[`${service.toUpperCase()}_API_KEY`] || null;
}

async function callOllama(prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.3, num_predict: 4096 },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Ollama error: ${err}`);
  }
  const data = await res.json();
  return data.response || '';
}

async function callGroq(prompt) {
  const key = readEnvKey('groq');
  if (!key) throw new Error('GROQ_API_KEY not found');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.1-70b-versatile',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Groq API error: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callAnthropicApi(prompt) {
  const key = readEnvKey('anthropic');
  if (!key) throw new Error('ANTHROPIC_API_KEY not found');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Anthropic API error: ${err}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

function tryClaudeCli() {
  const result = spawnSync('claude', ['-p', '--output-format', 'text'], {
    input: PROMPT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.status !== 0 || !result.stdout || !result.stdout.trim()) {
    return { ok: false, error: result.stderr || 'empty output', output: '' };
  }
  return { ok: true, output: result.stdout };
}

let output;
const cliResult = tryClaudeCli();
if (cliResult.ok) {
  output = cliResult.output;
  console.error('[judge] used claude CLI');
} else {
  console.error('[judge] claude CLI failed, trying Ollama...');
  try {
    output = await callOllama(PROMPT);
    console.error(`[judge] used Ollama (${OLLAMA_MODEL})`);
  } catch (err) {
    console.error('[judge] Ollama failed, trying Groq:', err.message);
    try {
      output = await callGroq(PROMPT);
      console.error('[judge] used Groq');
    } catch (err2) {
      console.error('[judge] Groq failed, falling back to Anthropic:', err2.message);
      try {
        output = await callAnthropicApi(PROMPT);
        console.error('[judge] used Anthropic API');
      } catch (err3) {
        console.error('All judge backends failed:', err3.message);
        process.exit(1);
      }
    }
  }
}

console.log(output);
console.log('\n\n=== DE-ANONYMIZED ===');
console.log(`Call A = ${firstLabel}`);
console.log(`Call B = ${secondLabel}`);

const winnerMatch = output.match(/Winner:\s*\*{0,2}([AB])\b/i);
const winnerLabel = winnerMatch ? { A: firstLabel, B: secondLabel }[winnerMatch[1].toUpperCase()] : null;
console.log(`WINNER_SYSTEM: ${winnerLabel || 'unknown'}`);
