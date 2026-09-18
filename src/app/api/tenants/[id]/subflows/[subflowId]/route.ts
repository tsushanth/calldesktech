import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

function toApi(row: {
  id: string; tenant_id: string; agent_id: string | null; scope: string;
  name: string; nodes: unknown; start_node_id: string | null;
  created_at: string; updated_at: string;
}) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    scope: row.scope,
    name: row.name,
    nodes: row.nodes,
    startNodeId: row.start_node_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; subflowId: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId, subflowId } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_subflows')
    .select('*')
    .eq('id', subflowId)
    .eq('tenant_id', tenantId)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ subflow: toApi(data) });
}

// PATCH — edit name/nodes/startNodeId/scope. Editing an already-published
// subflow does NOT retroactively change any flow that already embedded a
// snapshot of it — only agents that publish a new version afterward pick up
// the change, matching how editing a shared component works anywhere else
// in this app that snapshots at publish time.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; subflowId: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId, subflowId } = await params;
  const body = await request.json();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.nodes !== undefined) updates.nodes = body.nodes;
  if (body.startNodeId !== undefined) updates.start_node_id = body.startNodeId;
  if (body.scope !== undefined) updates.scope = body.scope;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_subflows')
    .update(updates)
    .eq('id', subflowId)
    .eq('tenant_id', tenantId)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ subflow: toApi(data) });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; subflowId: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId, subflowId } = await params;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('calldesk_subflows')
    .delete()
    .eq('id', subflowId)
    .eq('tenant_id', tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
