import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getAnthropicClient } from '@/lib/anthropic';
import type { FlowNode } from '@/types';
import { authorizeResource } from '@/lib/authz';

// POST /api/agents/[id]/test-cases/generate — drafts test cases from the
// agent's own LATEST PUBLISHED flow (not a generic template), matching
// Retell's own Simulation tab's "generate from agent" concept. Same
// tool-forcing pattern as /api/agents/generate-flow: a JSON-schema-
// constrained tool call, not parsed free text, plus real validation on top
// (a schema can't express "non-empty", "at least one case", etc). Results
// are inserted directly rather than held for review — a test case is just
// three short text fields, cheap to look at/delete afterward, unlike a
// whole flow.
const GENERATE_TEST_CASES_TOOL = {
  name: 'emit_test_cases',
  description: 'Emit a set of test cases exercising the real paths through this agent\'s conversation flow.',
  input_schema: {
    type: 'object' as const,
    properties: {
      testCases: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'short label, e.g. "Books an appointment"' },
            userPrompt: { type: 'string', description: 'what a simulated caller would actually say to trigger this path, first-person, e.g. "I need to reschedule my appointment to Friday"' },
            successCriteria: { type: 'string', description: 'what a passing run must have done, in plain English, e.g. "Agent collects a new date and confirms the reschedule"' },
          },
          required: ['name', 'userPrompt', 'successCriteria'],
        },
      },
    },
    required: ['testCases'],
  },
};

function summarizeFlow(nodes: FlowNode[], startNodeId: string): string {
  const lines = nodes.map((n) => {
    const edgeDescs = (n.edges || [])
      .map((e) => {
        const cond = typeof e.condition === 'string' ? e.condition : typeof e.condition === 'object' ? `${e.condition.field} ${e.condition.operator} ${e.condition.value}` : 'default';
        return `  -> ${e.target} when: ${cond}`;
      })
      .join('\n');
    return `Node "${n.id}" (${n.type})${n.id === startNodeId ? ' [START]' : ''}:\n${n.prompt ? `  instructions: ${n.prompt}\n` : ''}${edgeDescs}`;
  });
  return lines.join('\n\n');
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_agents', (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: agentId } = await params;
  const supabase = getSupabaseAdmin();

  const { data: versions, error: versionsError } = await supabase
    .from('calldesk_agent_versions')
    .select('flow_id, version_number')
    .eq('agent_id', agentId)
    .order('version_number', { ascending: false })
    .limit(1);
  if (versionsError) return NextResponse.json({ error: versionsError.message }, { status: 500 });
  const latest = versions?.[0];
  if (!latest?.flow_id) {
    return NextResponse.json({ error: 'This agent has no published version yet — publish one first.' }, { status: 400 });
  }

  const { data: flow, error: flowError } = await supabase
    .from('calldesk_conversation_flows')
    .select('nodes, global_settings')
    .eq('id', latest.flow_id)
    .single();
  if (flowError || !flow) return NextResponse.json({ error: 'Could not load the published flow' }, { status: 500 });

  const nodes = (flow.nodes || []) as FlowNode[];
  const startNodeId = (flow.global_settings as { startNodeId?: string })?.startNodeId || nodes[0]?.id;
  if (nodes.length === 0) {
    return NextResponse.json({ error: 'The published flow has no nodes to base test cases on' }, { status: 400 });
  }

  let anthropic;
  try {
    anthropic = getAnthropicClient();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Anthropic not configured' }, { status: 500 });
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 2000,
      system:
        'You write test cases for a voice AI agent, given its real conversation flow (nodes and the edge ' +
        'conditions that move between them). Call emit_test_cases with 3-6 test cases that together cover the ' +
        "flow's real distinct paths (its main branches, not just the happy path) — each one a realistic thing a " +
        'caller would actually say, plus what a passing run must accomplish. Do not invent capabilities the flow ' +
        "doesn't have.",
      messages: [{ role: 'user', content: `Start node: ${startNodeId}\n\n${summarizeFlow(nodes, startNodeId)}` }],
      tools: [GENERATE_TEST_CASES_TOOL],
      tool_choice: { type: 'tool', name: 'emit_test_cases' },
    });

    const toolUse = message.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      return NextResponse.json({ error: 'The model did not return any test cases — try again.' }, { status: 502 });
    }
    const input = toolUse.input as { testCases?: Array<{ name?: string; userPrompt?: string; successCriteria?: string }> };
    const drafted = (input.testCases || []).filter((t) => t.name?.trim() && t.userPrompt?.trim() && t.successCriteria?.trim());
    if (drafted.length === 0) {
      return NextResponse.json({ error: 'The model returned no usable test cases — try again.' }, { status: 502 });
    }

    const { data: inserted, error: insertError } = await supabase
      .from('calldesk_agent_test_cases')
      .insert(
        drafted.map((t) => ({
          agent_id: agentId,
          name: t.name!.trim(),
          user_prompt: t.userPrompt!.trim(),
          success_criteria: t.successCriteria!.trim(),
        }))
      )
      .select();
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    return NextResponse.json({ testCases: inserted }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate test cases';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
