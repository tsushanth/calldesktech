import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeResource } from '@/lib/authz';

// GET /api/agents/[id]/environments — this agent's staging/production
// environments, each with the version it currently points to (or null if
// nothing's been promoted into it yet). Every agent has both, seeded at
// creation (see /api/tenants/[id]/agents route) and backfilled by migration
// 036 for agents that existed before this feature.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params;
  const __auth = await authorizeResource(request, 'calldesk_agents', agentId);
  if (!__auth.ok) return __auth.response;

  const supabase = getSupabaseAdmin();
  const { data: environments, error } = await supabase
    .from('calldesk_agent_environments')
    .select('id, name, version_id, updated_at, calldesk_agent_versions(version_number, voice_engine)')
    .eq('agent_id', agentId)
    .order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ environments });
}
