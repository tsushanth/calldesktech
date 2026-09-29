import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient } from '@/lib/anthropic';

// POST /api/assist/suggest — real-time sales-call coaching, v0.
//
// Takes a call goal plus the rolling transcript of a live conversation
// (produced client-side by the browser's own speech recognition — nothing
// is recorded or stored here) and returns:
//   - stage: where the call is relative to the goal (industry-standard
//     "playbook stage" framing — Cresta/Balto-style tools track this so
//     suggestions are anchored to the goal, not just the last couple of
//     lines)
//   - line: a ready-to-read verbatim sentence
//   - cue: a short direction to paraphrase in the agent's own words
// Both line and cue are always returned — which one an agent reaches for
// is a per-moment judgment call (precision-critical moments like pricing
// favor the verbatim line; rapport-building moments favor the cue so it
// doesn't sound read-aloud), matching how Cresta/Balto offer both rather
// than forcing one mode for the whole call.
//
// Gated by CALL_ASSIST_SECRET, mirroring the bearer-secret pattern already
// used for demo-call/live rather than the NextAuth/session flow, since the
// page this serves is an internal tool, not a customer-facing one.
//
// This is transcript-only text in, text out — no audio is ever sent to or
// stored by this route. The frontend page still has to disclose the call is
// being assisted/monitored before the substantive conversation starts; that
// requirement doesn't go away just because nothing here is persisted (see
// two-party consent / wiretap statutes — the trigger is intercepting the
// call's content, not retention).
//
// No speaker attribution: an earlier version asked the model to guess who
// said each chunk ("you" vs "customer") from conversational content alone,
// since there's only one mono mic input and no real audio diarization.
// Tested against an actual call transcript and it mislabeled the very first
// line (an unambiguous agent greeting) as the customer — the guess isn't
// reliable, so it's not offered at all rather than shown wrong. Real speaker
// separation needs actual per-leg audio capture (e.g. Twilio Media Streams
// or a diarization-capable STT), which is separate, larger work.

const MODEL = process.env.CALL_ASSIST_MODEL || 'claude-haiku-4-5';

const DEFAULT_GOAL =
  'Get the business owner to agree to forward their overflow/after-hours calls to a number we give them, for a free 2-week trial of our AI phone-answering service.';

const STAGES = ['opening', 'discovery', 'objection', 'close', 'wrap-up'] as const;
type Stage = (typeof STAGES)[number];

const SYSTEM_PROMPT = `You are coaching a human sales agent live, mid phone call, at a company selling an AI phone-answering service to small US businesses (plumbers, insurance agents, freight brokers, etc).

You will be given the call's goal, then the rolling transcript so far (most recent lines last). Every suggestion must move toward the goal, not just react to the last line — if the conversation has drifted, the right suggestion is often the thing that steers it back, not just a reply in kind.

Reply with ONLY a JSON object, no other text:
{"stage": "opening" | "discovery" | "objection" | "close" | "wrap-up", "line": "...", "cue": "..."}
- "stage": where this call is relative to the goal right now.
- "line": ONE ready-to-read sentence (under 20 words) the agent could say verbatim.
- "cue": a short direction (under 12 words) for what to bring up, for the agent to phrase in their own words instead, e.g. "ask what happens to calls when the crew's on a job".
- line and cue should point at the same next move, just in two forms — not two different ideas.

Ground rules the agent must never break, and neither may your line or cue:
- Never invent a statistic or claim a result that hasn't been proven.
- Never pressure someone who's said no. If the transcript shows a clear decline, both line and cue should be a polite close, not a rebuttal.
- The only offer: a free 2-week trial, capped at 50 minutes of calls, no credit card.

Always give your best real suggestion, even from very little — a single greeting, a one-word answer, or an ambiguous fragment is still enough to suggest the natural next step toward the goal (e.g. "greet them and ask if now's a bad time" after just a hello). Live speech-to-text is often choppy and missing words; work with what's there rather than waiting for a clean, complete transcript. Reserve "(listening)" for line and cue ONLY when the transcript is empty or is truly just noise/fragments with no words that could plausibly start a conversation — not merely short.`;

export async function POST(request: NextRequest) {
  const secret = process.env.CALL_ASSIST_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Call assist is not configured' }, { status: 500 });
  }
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const transcript = typeof body.transcript === 'string' ? body.transcript.slice(-4000) : '';
  const goal = typeof body.goal === 'string' && body.goal.trim() ? body.goal.trim().slice(0, 500) : DEFAULT_GOAL;
  if (!transcript.trim()) {
    return NextResponse.json({ line: '(listening)', cue: '(listening)', stage: 'opening' as Stage });
  }

  try {
    const message = await getAnthropicClient().messages.create({
      model: MODEL,
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Call goal: ${goal}\n\nTranscript so far:\n${transcript}` }],
    });
    const text = message.content.find((b) => b.type === 'text');
    const raw = text && 'text' in text ? text.text.trim() : '';
    let line = '(listening)';
    let cue = '(listening)';
    let stage: Stage = 'opening';
    try {
      const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''));
      if (typeof parsed.line === 'string') line = parsed.line;
      if (typeof parsed.cue === 'string') cue = parsed.cue;
      if (STAGES.includes(parsed.stage)) stage = parsed.stage;
    } catch {
      if (raw) line = raw; // model didn't return JSON — still show something useful
    }
    return NextResponse.json({ line, cue, stage });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'suggestion failed' },
      { status: 502 },
    );
  }
}
