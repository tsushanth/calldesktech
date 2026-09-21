import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getAnthropicClient } from '@/lib/anthropic';
import { transcriptToText } from '@/lib/callQa';
import type { FlowNode } from '@/types';
import { authorizeResource } from '@/lib/authz';

// POST /api/agents/[id]/copilot/analyze — "Copilot": looks at this agent's
// real recent call history (transcripts + QA critiques/scores) and proposes
// concrete node-level prompt edits, each grounded in specific transcript
// excerpts. Analysis-and-suggestion only — this route never writes to the
// flow itself; suggestions land in calldesk_agent_copilot_suggestions
// (migration 037) with status 'pending', and accepting one is a separate
// write that goes through the normal draft-version create path
// (POST /api/agents/[id]/versions), same as any other manual flow edit.
//
// Real join path (there is no calldesk_call_logs.agent_id column — a call
// row only carries tenant_id + to_number): a call belongs to this agent
// when it was made to a phone number CURRENTLY routed (inbound, direct
// version pin or via an environment — see migration 036 and
// /api/phone-numbers/[id]/routing) to one of this agent's versions. This is
// the same resolution the routing route itself uses; it is necessarily
// "current routing", not "who owned this number when the call came in" —
// there's no historical routing log, so a call under a since-repointed
// number won't show up here. That's a real product gap, not something this
// route can paper over.
const MIN_CALLS = 5;
const MAX_CALLS_ANALYZED = 40;

const ANALYZE_TOOL = {
  name: 'emit_copilot_suggestions',
  description:
    'Emit concrete, transcript-grounded edits to this agent\'s conversation-flow nodes, based on recurring failure patterns across the given call transcripts and QA critiques. Every suggestion must cite real call ids as evidence.',
  input_schema: {
    type: 'object' as const,
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nodeId: { type: 'string', description: 'the exact id of the flow node this edit applies to, from the node list given' },
            suggestedText: { type: 'string', description: 'the full replacement prompt text for that node (not a diff/patch — the complete new text)' },
            rationale: {
              type: 'string',
              description:
                'why this change would help, citing the SPECIFIC recurring problem seen in the transcripts (e.g. what callers asked that the node could not answer, or a QA critique pattern) — never generic advice like "be more helpful"',
            },
            supportingCallIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'call ids (from the list given) whose transcript/critique actually shows this problem',
            },
          },
          required: ['nodeId', 'suggestedText', 'rationale', 'supportingCallIds'],
        },
      },
      summary: { type: 'string', description: 'one or two sentences on the main recurring failure pattern(s) found, or empty if none were found' },
    },
    required: ['suggestions', 'summary'],
  },
};

const SYSTEM_PROMPT = `You are a senior conversation designer reviewing an AI phone agent's recent real call transcripts and QA reviews to find RECURRING problems and propose SPECIFIC fixes to the agent's own flow nodes.

Rules:
- Only propose an edit when you can point to a real, recurring pattern across multiple (or at least one clearly severe) transcript/critique — never invent a plausible-sounding but ungrounded improvement.
- Every suggestion must name a real nodeId from the node list given, and its rationale must quote or closely paraphrase what actually happened in the cited calls (e.g. "in call X the caller asked for pricing three times and the agent said it didn't know each time").
- suggestedText is the full new prompt text for that node, not a diff.
- If the transcripts show no clear recurring problem, return an empty suggestions array and say so in summary. Do not manufacture suggestions to have something to show.
- Prefer few, high-confidence suggestions over many speculative ones.`;

function summarizeNodes(nodes: FlowNode[]): string {
  return nodes
    .filter((n) => n.type !== 'note' && (n.prompt || n.type === 'transfer' || n.type === 'knowledge_base'))
    .map((n) => `- nodeId: ${n.id} | type: ${n.type}\n  prompt: ${(n.prompt || '(no prompt text)').slice(0, 2000)}`)
    .join('\n\n');
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_agents', (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: agentId } = await params;
  const supabase = getSupabaseAdmin();

  const { data: agent, error: agentError } = await supabase
    .from('calldesk_agents')
    .select('id, tenant_id, name')
    .eq('id', agentId)
    .single();
  if (agentError || !agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  // Latest version + its flow (what the suggestions are grounded against).
  const { data: latestVersion, error: versionError } = await supabase
    .from('calldesk_agent_versions')
    .select('id, flow_id, version_number')
    .eq('agent_id', agentId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (versionError) return NextResponse.json({ error: versionError.message }, { status: 500 });
  if (!latestVersion) {
    return NextResponse.json({ error: 'Agent has no published version to analyze against' }, { status: 400 });
  }

  const { data: flow, error: flowError } = await supabase
    .from('calldesk_conversation_flows')
    .select('nodes, global_settings')
    .eq('id', latestVersion.flow_id)
    .single();
  if (flowError || !flow) return NextResponse.json({ error: 'Flow not found for latest version' }, { status: 404 });

  const nodes = (flow.nodes || []) as FlowNode[];

  // Every version this agent has ever published, then every phone number
  // currently routed (inbound) to one of those versions, directly or via an
  // environment — this is the real, current "which numbers are this
  // agent's" resolution (see routing route + migration 036).
  const { data: allVersions } = await supabase
    .from('calldesk_agent_versions')
    .select('id')
    .eq('agent_id', agentId);
  const versionIds = new Set((allVersions || []).map((v) => v.id));

  const { data: environments } = await supabase
    .from('calldesk_agent_environments')
    .select('id, version_id')
    .eq('agent_id', agentId);
  const environmentIds = new Set((environments || []).map((e) => e.id));

  const { data: phoneNumbers } = await supabase
    .from('calldesk_phone_numbers')
    .select('number, inbound_agent_version_id, inbound_environment_id')
    .eq('tenant_id', agent.tenant_id);

  const agentNumbers = (phoneNumbers || [])
    .filter(
      (p) =>
        (p.inbound_agent_version_id && versionIds.has(p.inbound_agent_version_id)) ||
        (p.inbound_environment_id && environmentIds.has(p.inbound_environment_id))
    )
    .map((p) => p.number);

  if (agentNumbers.length === 0) {
    return NextResponse.json(
      { error: 'No phone number is currently routed to this agent, so there is no call history to analyze.' },
      { status: 400 }
    );
  }

  const { data: calls, error: callsError } = await supabase
    .from('calldesk_call_logs')
    .select('id, transcript, qa_status, qa_sentiment, qa_score, qa_critique, outcome, created_at')
    .eq('tenant_id', agent.tenant_id)
    .in('to_number', agentNumbers)
    .not('transcript', 'is', null)
    .order('created_at', { ascending: false })
    .limit(MAX_CALLS_ANALYZED);
  if (callsError) return NextResponse.json({ error: callsError.message }, { status: 500 });

  const usableCalls = (calls || []).filter((c) => transcriptToText(c.transcript).trim().length > 0);

  if (usableCalls.length < MIN_CALLS) {
    return NextResponse.json({
      status: 'not_enough_history',
      message: `Not enough call history to analyze yet — found ${usableCalls.length} call${usableCalls.length === 1 ? '' : 's'} with a transcript, need at least ${MIN_CALLS}.`,
      callCount: usableCalls.length,
      suggestions: [],
    });
  }

  const callBlocks = usableCalls
    .map((c) => {
      const parts = [`Call ${c.id} (${c.created_at}, outcome: ${c.outcome || 'unknown'})`];
      if (c.qa_status === 'completed') {
        parts.push(`QA score: ${c.qa_score ?? 'n/a'}/5, sentiment: ${c.qa_sentiment || 'n/a'}`);
        if (c.qa_critique) parts.push(`QA critique: ${c.qa_critique}`);
      }
      parts.push('Transcript:\n' + transcriptToText(c.transcript).slice(0, 4000));
      return parts.join('\n');
    })
    .join('\n\n---\n\n');

  const userPrompt = [
    `Agent: "${agent.name}" — current flow nodes:\n\n${summarizeNodes(nodes)}`,
    `\nHere are its ${usableCalls.length} most recent real calls with transcripts (call ids are the ones you must cite in supportingCallIds):\n\n${callBlocks}`,
  ].join('\n\n');

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: process.env.CALL_QA_MODEL || 'claude-opus-5',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    tools: [ANALYZE_TOOL],
    tool_choice: { type: 'tool', name: 'emit_copilot_suggestions' },
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use' && b.name === 'emit_copilot_suggestions');
  if (!toolUse || toolUse.type !== 'tool_use') {
    return NextResponse.json({ error: 'Copilot analysis returned no usable result' }, { status: 502 });
  }

  const raw = toolUse.input as {
    suggestions: { nodeId: string; suggestedText: string; rationale: string; supportingCallIds: string[] }[];
    summary: string;
  };

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const validSuggestions = raw.suggestions.filter((s) => nodeById.has(s.nodeId) && s.suggestedText?.trim() && s.rationale?.trim());

  const rowsToInsert = validSuggestions.map((s) => ({
    agent_id: agentId,
    version_id: latestVersion.id,
    node_id: s.nodeId,
    current_text: nodeById.get(s.nodeId)?.prompt || null,
    suggested_text: s.suggestedText,
    rationale: s.rationale,
    supporting_call_ids: s.supportingCallIds.filter((id) => usableCalls.some((c) => c.id === id)),
    status: 'pending' as const,
  }));

  let inserted: typeof rowsToInsert = [];
  if (rowsToInsert.length > 0) {
    const { data, error: insertError } = await supabase
      .from('calldesk_agent_copilot_suggestions')
      .insert(rowsToInsert)
      .select();
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
    inserted = data || [];
  }

  return NextResponse.json({
    status: 'ok',
    callCount: usableCalls.length,
    summary: raw.summary,
    suggestions: inserted,
  });
}

// GET /api/agents/[id]/copilot/analyze — list persisted suggestions for the
// panel (avoids re-running Claude just to view what's already there).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_agents', (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: agentId } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_agent_copilot_suggestions')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ suggestions: data || [] });
}
