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

const MODEL = process.env.CALL_ASSIST_MODEL || 'claude-haiku-4-5';

const SYSTEM_PROMPT = `You are coaching a human sales agent live, mid phone call, at a company selling an AI phone-answering service to small US businesses (plumbers, insurance agents, freight brokers, etc). The agent forwards their overflow/after-hours calls to us for a free trial.

You will be given the rolling transcript so far (most recent lines last), then the single newest chunk that just finalized. There is only one microphone, so the newest chunk's speaker is NOT already known — decide it yourself from context (who was talking last, whether this chunk reads like a question/answer/continuation, self-identifying language, etc).

Reply with ONLY a JSON object, no other text: {"speaker": "you" | "customer", "suggestion": "..."}
- "speaker": who most likely said the newest chunk. "you" = the sales agent (our side); "customer" = the business owner/prospect being called.
- "suggestion": ONE short line (under 20 words) of what the agent should say or do next. No preamble, no quotes inside it.

Ground rules the agent must never break, and neither may your suggestion:
- Never invent a statistic or claim a result that hasn't been proven.
- Never pressure someone who's said no. If the transcript shows a clear decline, suggest a polite close, not a rebuttal.
- The only offer: a free 2-week trial, capped at 50 minutes of calls, no credit card.
- If there's too little to go on yet, use "suggestion": "(listening)"`;

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
  const chunk = typeof body.chunk === 'string' ? body.chunk.slice(-500) : '';
  if (!transcript.trim()) {
    return NextResponse.json({ suggestion: '(listening)', speaker: 'you' });
  }

  try {
    const message = await getAnthropicClient().messages.create({
      model: MODEL,
      max_tokens: 100,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `Rolling transcript so far:\n${transcript}\n\nNewest chunk to attribute: "${chunk || transcript}"` },
      ],
    });
    const text = message.content.find((b) => b.type === 'text');
    const raw = text && 'text' in text ? text.text.trim() : '';
    let suggestion = '(listening)';
    let speaker: 'you' | 'customer' = 'you';
    try {
      const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''));
      if (typeof parsed.suggestion === 'string') suggestion = parsed.suggestion;
      if (parsed.speaker === 'you' || parsed.speaker === 'customer') speaker = parsed.speaker;
    } catch {
      if (raw) suggestion = raw; // model didn't return JSON — still show something useful
    }
    return NextResponse.json({ suggestion, speaker });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'suggestion failed' },
      { status: 502 },
    );
  }
}
