import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeResource } from '@/lib/authz';
import { logAudit } from '@/lib/auditLog';

// GET /api/agents/[id] — fetch one agent
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_agents', (await params).id);
  if (!__auth.ok) return __auth.response;

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
  const __auth = await authorizeResource(request, 'calldesk_agents', (await params).id);
  if (!__auth.ok) return __auth.response;

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

// DELETE /api/agents/[id] — permanently delete an agent and everything under
// it. Safe as a single delete: calldesk_agent_versions/conversation_flows/
// knowledge_bases all have ON DELETE CASCADE on agent_id (migration 005), and
// anything that merely POINTS at one of this agent's versions — phone number
// routing, chat sessions, batch calls — has ON DELETE SET NULL, so it just
// goes back to unrouted/unset rather than leaving a dangling reference.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_agents', (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: agentId } = await params;
  const supabase = getSupabaseAdmin();
  const { data: agent } = await supabase.from('calldesk_agents').select('name').eq('id', agentId).maybeSingle();
  const { error } = await supabase.from('calldesk_agents').delete().eq('id', agentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    tenantId: __auth.tenantId ?? null,
    actorUserId: __auth.principal.userId,
    action: 'agent.delete',
    resourceType: 'calldesk_agents',
    resourceId: agentId,
    metadata: agent?.name ? { name: agent.name } : {},
  });

  return NextResponse.json({ success: true });
}
