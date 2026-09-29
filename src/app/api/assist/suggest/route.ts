import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient } from '@/lib/anthropic';

// POST /api/assist/suggest — real-time sales-call coaching, v0.
//
// Takes the rolling transcript of a live conversation (produced client-side
// by the browser's own speech recognition — nothing is recorded or stored
// here) and returns one short suggestion for what the agent should say next.
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

const SYSTEM_PROMPT = `You are coaching a human sales agent live, mid phone call, at a company selling an AI phone-answering service to small US businesses (plumbers, insurance agents, freight brokers, etc). The agent forwards their overflow/after-hours calls to us for a free trial.

You will be given the rolling transcript so far, most recent lines last. Reply with ONE short line (under 20 words) of what the agent should say or do next. No preamble, no quotes, no explanation — just the line itself, ready to read or paraphrase.

Ground rules the agent must never break, and neither may your suggestion:
- Never invent a statistic or claim a result that hasn't been proven.
- Never pressure someone who's said no. If the transcript shows a clear decline, suggest a polite close, not a rebuttal.
- The only offer: a free 2-week trial, capped at 50 minutes of calls, no credit card.
- If the transcript is too short or ambiguous to say anything useful yet, reply exactly: (listening)`;

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
  if (!transcript.trim()) {
    return NextResponse.json({ suggestion: '(listening)' });
  }

  try {
    const message = await getAnthropicClient().messages.create({
      model: MODEL,
      max_tokens: 60,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: transcript }],
    });
    const text = message.content.find((b) => b.type === 'text');
    const suggestion = text && 'text' in text ? text.text.trim() : '(listening)';
    return NextResponse.json({ suggestion });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'suggestion failed' },
      { status: 502 },
    );
  }
}
