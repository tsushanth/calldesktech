import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// DELETE /api/agents/[id]/test-cases/[testCaseId]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; testCaseId: string }> }
) {
  const { testCaseId } = await params;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('calldesk_agent_test_cases').delete().eq('id', testCaseId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
