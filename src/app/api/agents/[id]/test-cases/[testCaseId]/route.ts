import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeResource } from '@/lib/authz';

// DELETE /api/agents/[id]/test-cases/[testCaseId]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; testCaseId: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_agents', (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: agentId, testCaseId } = await params;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('calldesk_agent_test_cases').delete().eq('id', testCaseId).eq('agent_id', agentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
