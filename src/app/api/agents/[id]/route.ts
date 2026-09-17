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

// PATCH /api/agents/[id] — rename an agent. Every agent used to be stuck
// with whatever name it got at creation — either a hand-typed one from the
// old bare-name-prompt flow (real examples seen: "bjjh", "deepika") or the
// dropdown's generic "New Voice Agent"/"New Text Agent" default, with no way
// to fix it afterward short of editing the database directly.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params;
  const { name } = await request.json();
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Agent name is required' }, { status: 400 });
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_agents')
    .update({ name: name.trim() })
    .eq('id', agentId)
    .select()
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message || 'Agent not found' }, { status: 404 });
  return NextResponse.json({ agent: data });
}
