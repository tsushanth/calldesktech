import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// GET /api/agents/[id]/test-cases — list an agent's Simulation test cases.
// First pass of the Simulation tab: storage + listing only, no run/batch-
// testing execution yet — that needs its own call-orchestration work.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_agent_test_cases')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ testCases: data });
}

// POST /api/agents/[id]/test-cases — create a test case.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params;
  const { name, userPrompt, successCriteria } = await request.json();
  if (!name?.trim() || !userPrompt?.trim() || !successCriteria?.trim()) {
    return NextResponse.json({ error: 'Name, user prompt, and success criteria are all required' }, { status: 400 });
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_agent_test_cases')
    .insert({
      agent_id: agentId,
      name: name.trim(),
      user_prompt: userPrompt.trim(),
      success_criteria: successCriteria.trim(),
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ testCase: data }, { status: 201 });
}
