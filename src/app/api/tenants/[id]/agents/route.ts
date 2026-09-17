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

// POST /api/tenants/[id]/agents — create a new agent. Shared by two very
// different callers: OnboardingContext creates the tenant's implicit
// default agent this way and explicitly passes mode: 'simple' (Settings'
// wizard-blocks toggles keep editing that one agent going forward — see
// SettingsPage's `.find(a => a.mode === 'simple')`). Every other caller —
// chiefly the dashboard's "Create Agent" dropdown, whose agents are built
// from a template/generated flow and never touched by that wizard — used to
// get 'simple' too just because it was hardcoded here, which is why a
// freshly template-built, published agent still showed "Simple
// (wizard-owned)" with no way for the label to ever become accurate short of
// manually clicking "Advanced settings". Defaults to 'advanced' now; only an
// explicit mode: 'simple' in the request body opts into wizard ownership.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();
  const { name, mode } = await request.json();

  if (!name) {
    return NextResponse.json({ error: 'Agent name is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('calldesk_agents')
    .insert({ tenant_id: tenantId, name, mode: mode === 'simple' ? 'simple' : 'advanced' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ agent: data }, { status: 201 });
}
