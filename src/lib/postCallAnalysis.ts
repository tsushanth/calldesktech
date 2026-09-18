import type { SupabaseClient } from '@supabase/supabase-js';
import { getAnthropicClient, getCallQaModel } from '@/lib/anthropic';
import { transcriptToText } from '@/lib/callQa';

// Per-agent post-call analysis. The schema lives in the published version's
// flow global_settings.postCallAnalysis = { fields: [...] }. Default-off: no
// fields configured means no LLM call at all.

export type AnalysisFieldType = 'text' | 'boolean' | 'number' | 'enum';
export interface AnalysisField {
  name: string;
  type: AnalysisFieldType;
  description?: string;
  options?: string[];
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
    const opts = Array.isArray(options) ? options.filter((o): o is string => typeof o === 'string' && !!o.trim()) : [];
    if (type === 'enum' && opts.length === 0) continue;
    out.push({
      name: name.trim(),
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

// Throws on API/parse failure.
export async function extractCallAnalysis(transcript: string, fields: AnalysisField[]): Promise<Record<string, unknown>> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: getCallQaModel(),
    max_tokens: 1024,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: buildSchema(fields) } },
    system:
      'You extract structured data from a phone call transcript. Return a value for every requested field, or null when the transcript does not support one. Never guess.',
    messages: [{ role: 'user', content: 'Call transcript:\n"""\n' + transcript.trim() + '\n"""' }],
  });
  let text = '';
  for (const block of response.content) if (block.type === 'text') text += block.text;
  if (!text.trim()) throw new Error('Analysis model returned no text content');
  const parsed = JSON.parse(text) as Record<string, unknown>;
  // Keep only declared fields.
  const result: Record<string, unknown> = {};
  for (const f of fields) result[f.name] = parsed[f.name] ?? null;
  return result;
}

// Looks up the analysis schema for the version that owns this Retell agent id.
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
// analysis object, or null when not configured / no transcript / failed.
export async function runAndStorePostCallAnalysis(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>;
  retellCallId: string;
  retellAgentId: string;
  transcript: string | null | undefined;
}): Promise<Record<string, unknown> | null> {
  try {
    const text = transcriptToText(params.transcript);
    if (!text) return null;
    const fields = await loadFieldsForRetellAgent(params.supabase, params.retellAgentId);
    if (fields.length === 0) return null;
    const analysis = await extractCallAnalysis(text, fields);
    await params.supabase.from('calldesk_call_logs').update({ analysis }).eq('retell_call_id', params.retellCallId);
    return analysis;
  } catch (error) {
    console.error(`Post-call analysis failed for ${params.retellCallId}:`, error);
    return null;
  }
}
