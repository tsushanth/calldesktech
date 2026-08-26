import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// GET /api/tenants/[id]/agents — list a tenant's agents
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_agents')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ agents: data });
}

// POST /api/tenants/[id]/agents — create a new agent, in "simple" mode
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();
  const { name } = await request.json();

  if (!name) {
    return NextResponse.json({ error: 'Agent name is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('calldesk_agents')
    .insert({ tenant_id: tenantId, name, mode: 'simple' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ agent: data }, { status: 201 });
}
