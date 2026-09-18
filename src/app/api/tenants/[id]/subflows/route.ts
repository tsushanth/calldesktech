import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// GET /api/tenants/[id]/subflows?agentId=... — list subflows visible to an
// agent: every library-scoped subflow in the tenant, plus that agent's own
// agent-scoped ones. Omit agentId to list everything (used by a
// tenant-level "manage subflows" view, if one gets built later).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params;
  const agentId = request.nextUrl.searchParams.get('agentId');
  const supabase = getSupabaseAdmin();

  let query = supabase.from('calldesk_subflows').select('*').eq('tenant_id', tenantId);
  if (agentId) {
    query = query.or(`scope.eq.library,agent_id.eq.${agentId}`);
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const subflows = (data || []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    scope: row.scope,
    name: row.name,
    nodes: row.nodes,
    startNodeId: row.start_node_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  return NextResponse.json({ subflows });
}

// POST /api/tenants/[id]/subflows — create a new subflow (agent-scoped by
// default; pass scope: 'library' to make it reusable tenant-wide).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params;
  const body = await request.json();
  const { agentId, scope = 'agent', name, nodes = [], startNodeId } = body;

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (scope === 'agent' && !agentId) {
    return NextResponse.json({ error: 'agentId is required for agent-scoped subflows' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_subflows')
    .insert({
      tenant_id: tenantId,
      agent_id: scope === 'library' ? null : agentId,
      scope,
      name,
      nodes,
      start_node_id: startNodeId ?? null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    subflow: {
      id: data.id,
      tenantId: data.tenant_id,
      agentId: data.agent_id,
      scope: data.scope,
      name: data.name,
      nodes: data.nodes,
      startNodeId: data.start_node_id,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  });
}
