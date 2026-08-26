import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// GET /api/agents/[id] — fetch one agent
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_agents')
    .select('*')
    .eq('id', agentId)
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message || 'Agent not found' }, { status: 404 });
  return NextResponse.json({ agent: data });
}
