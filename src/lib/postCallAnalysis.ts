import type { SupabaseClient } from '@supabase/supabase-js';
import { getAnthropicClient, getCallQaModel } from '@/lib/anthropic';
import { transcriptToText } from '@/lib/callQa';

// Post-call analysis has two parts, merged into a single Claude call:
//   - Built-in fields (BUILT_IN_FIELDS below): always extracted for every
//     finished call, mirroring Retell's built-in post-call analysis.
//   - Custom fields: tenant-configurable, opt-in, empty by default. The
//     schema lives in the published version's flow
//     global_settings.postCallAnalysis = { fields: [...] }.
// Stored on calldesk_call_logs.analysis as { built_in: {...}, custom: {...} }.

export type AnalysisFieldType = 'text' | 'boolean' | 'number' | 'enum';
export interface AnalysisField {
  name: string;
  type: AnalysisFieldType;
  description?: string;
  options?: string[];
}

// Always-on built-in fields, additional to whatever custom fields the tenant
// configured. Keep these `name`s in sync with the BuiltInAnalysis shape below.
export const BUILT_IN_FIELDS: AnalysisField[] = [
  {
    name: 'call_summary',
    type: 'text',
    description: '1-2 sentence summary of what happened on the call.',
  },
  {
    name: 'call_successful',
    type: 'boolean',
    description: "Whether the call achieved its apparent goal (e.g. the caller's request was resolved or the intended action was completed).",
  },
  {
    name: 'in_voicemail',
    type: 'boolean',
    description: 'Whether this call was answered by a voicemail/answering machine rather than a live person.',
  },
  {
    name: 'user_sentiment',
    type: 'enum',
    description: "The caller's overall sentiment during the call.",
    options: ['positive', 'neutral', 'negative'],
  },
];

const BUILT_IN_FIELD_NAMES = new Set(BUILT_IN_FIELDS.map((f) => f.name));

export interface BuiltInAnalysis {
  call_summary: string | null;
  call_successful: boolean | null;
  in_voicemail: boolean | null;
  user_sentiment: 'positive' | 'neutral' | 'negative' | null;
}

export interface CallAnalysisResult {
  built_in: BuiltInAnalysis;
  custom: Record<string, unknown>;
}

// Conservative defaults used when there's no transcript text to analyze at
// all (e.g. an immediate hangup). No LLM call is made in this case.
function degradedBuiltIn(): BuiltInAnalysis {
  return {
    call_summary: 'Call ended with no transcript available.',
    call_successful: false,
    in_voicemail: true,
    user_sentiment: 'neutral',
  };
}

export function parseAnalysisFields(raw: unknown): AnalysisField[] {
  const fields = (raw as { fields?: unknown } | null | undefined)?.fields;
  if (!Array.isArray(fields)) return [];
  const out: AnalysisField[] = [];
  for (const f of fields) {
    if (!f || typeof f !== 'object') continue;
    const { name, type, description, options } = f as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim()) continue;
    if (type !== 'text' && type !== 'boolean' && type !== 'number' && type !== 'enum') continue;
    const trimmedName = name.trim();
    // Built-in field names are reserved — a tenant-configured field with the
    // same name would otherwise collide in the merged schema.
    if (BUILT_IN_FIELD_NAMES.has(trimmedName)) continue;
    const opts = Array.isArray(options) ? options.filter((o): o is string => typeof o === 'string' && !!o.trim()) : [];
    if (type === 'enum' && opts.length === 0) continue;
    out.push({
      name: trimmedName,
      type,
      description: typeof description === 'string' ? description : '',
      ...(type === 'enum' ? { options: opts } : {}),
    });
  }
  return out;
}

function buildSchema(fields: AnalysisField[]) {
  const properties: Record<string, unknown> = {};
  for (const f of fields) {
    const description = f.description || undefined;
    if (f.type === 'enum') properties[f.name] = { type: ['string', 'null'], enum: [...(f.options || []), null], description };
    else if (f.type === 'text') properties[f.name] = { type: ['string', 'null'], description };
    else if (f.type === 'boolean') properties[f.name] = { type: ['boolean', 'null'], description };
    else properties[f.name] = { type: ['number', 'null'], description };
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: fields.map((f) => f.name),
    properties,
  };
}

// Extracts BOTH the built-in fields and any custom fields in a single Claude
// call. Throws on API/parse failure — callers must handle that (see
// runAndStorePostCallAnalysis, which never throws). Degrades gracefully for
// very short transcripts (the model is instructed to fall back to
// voicemail/unsuccessful defaults rather than guess) but does NOT special
// case empty input — callers should skip calling this at all when there's no
// transcript text (see degradedBuiltIn / runAndStorePostCallAnalysis).
export async function extractCallAnalysis(transcript: string, customFields: AnalysisField[] = []): Promise<CallAnalysisResult> {
  const allFields = [...BUILT_IN_FIELDS, ...customFields];
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: getCallQaModel(),
    max_tokens: 1024,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: buildSchema(allFields) } },
    system:
      'You extract structured data from a phone call transcript. Return a value for every requested field, or null when the transcript does not support one. Never guess. ' +
      'If the transcript is empty, extremely short, or only contains a voicemail greeting/beep with no live conversation, set in_voicemail to true, call_successful to false, and write a minimal call_summary describing that — do not fabricate details.',
    messages: [{ role: 'user', content: 'Call transcript:\n"""\n' + transcript.trim() + '\n"""' }],
  });
  let text = '';
  for (const block of response.content) if (block.type === 'text') text += block.text;
  if (!text.trim()) throw new Error('Analysis model returned no text content');
  const parsed = JSON.parse(text) as Record<string, unknown>;

  const built_in: BuiltInAnalysis = {
    call_summary: typeof parsed.call_summary === 'string' ? parsed.call_summary : null,
    call_successful: typeof parsed.call_successful === 'boolean' ? parsed.call_successful : null,
    in_voicemail: typeof parsed.in_voicemail === 'boolean' ? parsed.in_voicemail : null,
    user_sentiment:
      parsed.user_sentiment === 'positive' || parsed.user_sentiment === 'neutral' || parsed.user_sentiment === 'negative'
        ? parsed.user_sentiment
        : null,
  };

  const custom: Record<string, unknown> = {};
  for (const f of customFields) custom[f.name] = parsed[f.name] ?? null;

  return { built_in, custom };
}

// Looks up the tenant-configured custom fields for the version that owns this
// Retell agent id. Returns [] when none are configured — the built-in fields
// still always run regardless of this result.
async function loadFieldsForRetellAgent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  retellAgentId: string
): Promise<AnalysisField[]> {
  const { data: version } = await supabase
    .from('calldesk_agent_versions')
    .select('flow_id')
    .eq('retell_agent_id', retellAgentId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!version?.flow_id) return [];
  const { data: flow } = await supabase
    .from('calldesk_conversation_flows')
    .select('global_settings')
    .eq('id', version.flow_id)
    .maybeSingle();
  return parseAnalysisFields(flow?.global_settings?.postCallAnalysis);
}

// Runs analysis and stores it on the call log. NEVER throws; returns the
// analysis object, or null only when the write itself could not be
// attempted (e.g. the whole thing is wrapped in try/catch below). Runs for
// EVERY finished call, regardless of whether the tenant configured any
// custom fields — built-in fields are always extracted. For a
// missing/empty transcript (immediate hangup, voicemail-only with no
// transcript), no LLM call is made and conservative defaults are stored
// instead so this never throws or wastes a call on empty input.
export async function runAndStorePostCallAnalysis(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>;
  retellCallId: string;
  retellAgentId: string;
  transcript: string | null | undefined;
}): Promise<CallAnalysisResult | null> {
  try {
    const text = transcriptToText(params.transcript);
    const fields = await loadFieldsForRetellAgent(params.supabase, params.retellAgentId);

    let analysis: CallAnalysisResult;
    if (!text) {
      // No transcript text at all — degrade gracefully instead of calling
      // the model on empty input. Custom fields can't be inferred either,
      // so they're all null.
      const custom: Record<string, unknown> = {};
      for (const f of fields) custom[f.name] = null;
      analysis = { built_in: degradedBuiltIn(), custom };
    } else {
      analysis = await extractCallAnalysis(text, fields);
    }

    await params.supabase.from('calldesk_call_logs').update({ analysis }).eq('retell_call_id', params.retellCallId);
    return analysis;
  } catch (error) {
    console.error(`Post-call analysis failed for ${params.retellCallId}:`, error);
    return null;
  }
}
