import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// POST /api/agents/[id]/graduate — permanently switches an agent from
// "simple" (wizard-owned) to "advanced" (console-owned). One-way by design:
// a hand-edited flow never gets reverse-parsed back into wizard fields, so
// there's no route back. The confirmation step lives in the UI, not here.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_agents')
    .update({ mode: 'advanced' })
    .eq('id', agentId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ agent: data });
}
