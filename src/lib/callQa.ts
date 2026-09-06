import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json } from '@/types/database';
import { getAnthropicClient, getCallQaModel } from '@/lib/anthropic';

// AI Quality Assurance — the post-call review step. Given a call transcript
// (and, when we can fetch it, the agent's own instructions), Claude returns
// the caller's overall sentiment, a 1–5 quality score, and a short critique.
// Kept out of the webhook route so it can be reused by the dashboard's
// backfill endpoint too.

export type CallSentiment = 'positive' | 'neutral' | 'negative';

export interface CallQaResult {
  sentiment: CallSentiment;
  score: number; // 1–5
  critique: string;
}

// JSON Schema handed to Claude via structured outputs (output_config.format),
// which guarantees the response parses into exactly this shape — no prompt
// coaxing or brittle regex extraction needed.
const QA_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sentiment', 'score', 'critique'],
  properties: {
    sentiment: {
      type: 'string',
      enum: ['positive', 'neutral', 'negative'],
      description: "The caller's overall sentiment by the end of the call.",
    },
    score: {
      type: 'integer',
      minimum: 1,
      maximum: 5,
      description:
        'Overall quality of how the AI agent handled the call, 1 (poor) to 5 (excellent).',
    },
    critique: {
      type: 'string',
      description:
        'One to three sentences on what the agent did well and what it could improve.',
    },
  },
} as const;

const SYSTEM_PROMPT = `You are a strict but fair quality-assurance reviewer for phone calls handled by an AI voice agent (an AI receptionist / phone assistant for a business).

You will be given the transcript of a single completed call, and optionally the instructions the agent was configured to follow. Evaluate the call and return:
- sentiment: the caller's overall sentiment by the end of the call (positive, neutral, or negative).
- score: an integer 1–5 rating how well the agent handled the call. Weigh whether the agent followed its given instructions (when provided), was accurate and helpful, stayed professional, collected the information it needed, and resolved the caller's request. 5 = handled excellently; 1 = clearly mishandled.
- critique: 1–3 concise sentences on what the agent did well and what it should improve. Be specific and actionable; do not restate the whole call.

Judge only what the transcript supports. If the transcript is sparse, score conservatively and say so in the critique.`;

// Turn either the raw Retell transcript string or the JSONB shape we persist
// (`[{ role, content }, ...]`) back into plain text for the model / display.
export function transcriptToText(transcript: Json | string | null | undefined): string {
  if (!transcript) return '';
  if (typeof transcript === 'string') return transcript.trim();
  if (Array.isArray(transcript)) {
    return transcript
      .map((turn) => {
        if (turn && typeof turn === 'object' && !Array.isArray(turn)) {
          const role = typeof turn.role === 'string' ? turn.role : '';
          const content = typeof turn.content === 'string' ? turn.content : '';
          return role ? `${role}: ${content}` : content;
        }
        return typeof turn === 'string' ? turn : '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

// Single Claude call that scores one transcript. Throws on API/parse failure so
// callers can record a 'failed' QA status.
export async function analyzeCallQuality(params: {
  transcript: string;
  agentInstructions?: string | null;
}): Promise<CallQaResult> {
  const { transcript, agentInstructions } = params;
  const client = getAnthropicClient();

  const userPrompt = [
    agentInstructions?.trim()
      ? `The agent was configured with these instructions:\n"""\n${agentInstructions.trim()}\n"""\n`
      : 'No explicit agent instructions were available — evaluate against general best practices for a professional phone assistant.\n',
    'Call transcript:\n"""\n' + transcript.trim() + '\n"""',
  ].join('\n');

  const response = await client.messages.create({
    model: getCallQaModel(),
    max_tokens: 1024,
    // Bounded classification + short critique — low effort keeps this cheap and
    // fast (it runs on every call); structured outputs pin the JSON shape.
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: QA_OUTPUT_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  let text = '';
  for (const block of response.content) {
    if (block.type === 'text') text += block.text;
  }
  text = text.trim();

  if (!text) {
    throw new Error('QA model returned no text content');
  }

  const parsed = JSON.parse(text) as CallQaResult;
  return {
    sentiment: parsed.sentiment,
    score: parsed.score,
    critique: parsed.critique,
  };
}

// Runs QA for one call and writes the result back onto its calldesk_call_logs
// row. Never throws — QA is a best-effort post-processing step and must not
// break the webhook or a backfill batch. Returns the status it recorded.
export async function runAndStoreCallQa(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>;
  retellCallId: string;
  transcript: Json | string | null | undefined;
  agentInstructions?: string | null;
}): Promise<'completed' | 'failed' | 'skipped'> {
  const { supabase, retellCallId, transcript, agentInstructions } = params;
  const text = transcriptToText(transcript);

  if (!text) {
    await supabase
      .from('calldesk_call_logs')
      .update({ qa_status: 'skipped', qa_analyzed_at: new Date().toISOString() })
      .eq('retell_call_id', retellCallId);
    return 'skipped';
  }

  try {
    const result = await analyzeCallQuality({ transcript: text, agentInstructions });
    await supabase
      .from('calldesk_call_logs')
      .update({
        qa_status: 'completed',
        qa_sentiment: result.sentiment,
        qa_score: result.score,
        qa_critique: result.critique,
        qa_model: getCallQaModel(),
        qa_analyzed_at: new Date().toISOString(),
      })
      .eq('retell_call_id', retellCallId);
    return 'completed';
  } catch (error) {
    console.error(`Call QA failed for ${retellCallId}:`, error);
    await supabase
      .from('calldesk_call_logs')
      .update({ qa_status: 'failed', qa_analyzed_at: new Date().toISOString() })
      .eq('retell_call_id', retellCallId);
    return 'failed';
  }
}
