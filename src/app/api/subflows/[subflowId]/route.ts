import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeResource } from '@/lib/authz';

// Tenant-less convenience routes for the standalone subflow editor page
// (/dashboard/subflows/[subflowId]), which is linked to directly from a
// subflow_ref node and doesn't carry a tenantId in its own URL. Mirrors
// /api/tenants/[id]/subflows/[subflowId] but looks the row up by id alone.
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
  { params }: { params: Promise<{ subflowId: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_subflows', (await params).subflowId);
  if (!__auth.ok) return __auth.response;

  const { subflowId } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('calldesk_subflows').select('*').eq('id', subflowId).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ subflow: toApi(data) });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ subflowId: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_subflows', (await params).subflowId);
  if (!__auth.ok) return __auth.response;

  const { subflowId } = await params;
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
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ subflow: toApi(data) });
}
