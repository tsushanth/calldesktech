import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeResource } from '@/lib/authz';

// GET /api/flows/[id] — a single flow's real content (nodes + global
// settings). Needed so the version editor can load an EXISTING version's
// flow to edit, not just create a brand-new one — calldesk_agent_versions
// only stores flow_id, not the nodes themselves (those live on
// calldesk_conversation_flows), and no route exposed a single flow by id
// until now (the only other flows route lists ALL of a tenant's flows).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_conversation_flows', (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: flowId } = await params;
  const supabase = getSupabaseAdmin();
  const { data: flow, error } = await supabase
    .from('calldesk_conversation_flows')
    .select('id, nodes, global_settings')
    .eq('id', flowId)
    .single();
  if (error || !flow) {
    return NextResponse.json({ error: error?.message || 'Flow not found' }, { status: 404 });
  }
  return NextResponse.json({ flow });
}
