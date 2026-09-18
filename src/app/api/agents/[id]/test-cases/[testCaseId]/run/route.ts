import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { runTestCaseSimulation } from '@/lib/testCaseSimulator';
import type { EngineFlow } from '@/lib/textFlowEngine';
import { authorizeResource } from '@/lib/authz';

// POST /api/agents/[id]/test-cases/[testCaseId]/run — simulates the test
// case against the agent's own latest PUBLISHED flow (a synthetic caller LLM
// converses with it over text, no real phone call) and judges the transcript
// against the test case's success criteria. See src/lib/testCaseSimulator.ts
// for why text instead of a real call.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; testCaseId: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_agents', (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: agentId, testCaseId } = await params;
  const supabase = getSupabaseAdmin();

  const { data: testCase, error: testCaseError } = await supabase
    .from('calldesk_agent_test_cases')
    .select('user_prompt, success_criteria')
    .eq('id', testCaseId)
    .single();
  if (testCaseError || !testCase) return NextResponse.json({ error: 'Test case not found' }, { status: 404 });

  const { data: versions, error: versionsError } = await supabase
    .from('calldesk_agent_versions')
    .select('flow_id')
    .eq('agent_id', agentId)
    .order('version_number', { ascending: false })
    .limit(1);
  if (versionsError) return NextResponse.json({ error: versionsError.message }, { status: 500 });
  const latest = versions?.[0];
  if (!latest?.flow_id) {
    return NextResponse.json({ error: 'This agent has no published version yet — publish one first.' }, { status: 400 });
  }

  const { data: flowRow, error: flowError } = await supabase
    .from('calldesk_conversation_flows')
    .select('nodes, global_settings')
    .eq('id', latest.flow_id)
    .single();
  if (flowError || !flowRow) return NextResponse.json({ error: 'Could not load the published flow' }, { status: 500 });

  const nodes = flowRow.nodes || [];
  const startNodeId = (flowRow.global_settings as { startNodeId?: string })?.startNodeId || nodes[0]?.id;
  if (!startNodeId) return NextResponse.json({ error: 'The published flow has no start node' }, { status: 400 });

  const flow: EngineFlow = { nodes, startNodeId, globalSettings: flowRow.global_settings };

  try {
    const result = await runTestCaseSimulation(flow, {
      userPrompt: testCase.user_prompt,
      successCriteria: testCase.success_criteria,
    });

    const { data: run, error: insertError } = await supabase
      .from('calldesk_test_case_runs')
      .insert({
        test_case_id: testCaseId,
        passed: result.passed,
        reasoning: result.reasoning,
        transcript: result.transcript,
      })
      .select()
      .single();
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    return NextResponse.json({ run }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Simulation failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
