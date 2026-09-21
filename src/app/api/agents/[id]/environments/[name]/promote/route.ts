import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeResource, belongsToTenant } from '@/lib/authz';

// POST /api/agents/[id]/environments/[name]/promote — points this
// environment (staging|production) at a specific version of THIS agent.
// Every phone number/batch call/test call currently routed to this
// environment (via inbound_environment_id/outbound_environment_id) picks up
// the new version immediately, with no re-routing needed — that's the whole
// point of environments vs. the old direct-version-pin-only model.
//
// For a retell-engine version, also re-syncs the flow to Retell for every
// number whose INBOUND slot currently points at this environment — a raw
// version-pin promotion already does this via the routing route's own
// sync-retell call, but an environment promotion changes what a number
// resolves to without ever calling that route, so it has to trigger the
// same sync itself.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> }
) {
  const { id: agentId, name } = await params;
  const __auth = await authorizeResource(request, 'calldesk_agents', agentId);
  if (!__auth.ok) return __auth.response;

  if (name !== 'staging' && name !== 'production') {
    return NextResponse.json({ error: 'name must be "staging" or "production"' }, { status: 400 });
  }

  const { versionId } = await request.json();
  if (!versionId) {
    return NextResponse.json({ error: 'versionId is required' }, { status: 400 });
  }
  if (__auth.tenantId && !(await belongsToTenant('calldesk_agent_versions', versionId, __auth.tenantId))) {
    return NextResponse.json({ error: 'versionId not found' }, { status: 404 });
  }

  const supabase = getSupabaseAdmin();
  const { data: version } = await supabase
    .from('calldesk_agent_versions')
    .select('id, agent_id, voice_engine')
    .eq('id', versionId)
    .single();
  if (!version || version.agent_id !== agentId) {
    return NextResponse.json({ error: 'This version does not belong to this agent' }, { status: 404 });
  }

  const { data: environment, error } = await supabase
    .from('calldesk_agent_environments')
    .update({ version_id: versionId })
    .eq('agent_id', agentId)
    .eq('name', name)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Every number's inbound/outbound slot is still a raw agent_version_id
  // column underneath (see migration 036) — call-loop-poc's
  // resolveInboundCall reads that column directly and has no idea
  // environments exist. Routing a number TO an environment keeps that
  // column in sync at routing time (see the routing route); promoting has
  // to do the same thing for every number already pointed at this
  // environment, or a poc-engine promotion would silently do nothing.
  const [{ data: inboundNumbers }, { data: outboundNumbers }] = await Promise.all([
    supabase.from('calldesk_phone_numbers').update({ inbound_agent_version_id: versionId }).eq('inbound_environment_id', environment.id).select('id'),
    supabase.from('calldesk_phone_numbers').update({ outbound_agent_version_id: versionId }).eq('outbound_environment_id', environment.id).select('id'),
  ]);

  let resynced = 0;
  if (version.voice_engine === 'retell') {
    for (const _n of inboundNumbers || []) {
      try {
        await fetch(`${request.nextUrl.origin}/api/agent-versions/${versionId}/sync-retell`, {
          method: 'POST',
          headers: { cookie: request.headers.get('cookie') || '', authorization: request.headers.get('authorization') || '' },
        });
        resynced++;
      } catch {
        // Best-effort — the number still resolves to the right version at
        // call time regardless (raw column above is already updated), this
        // only affects how promptly Retell's own copy of the flow catches up.
      }
    }
  }

  return NextResponse.json({
    environment,
    reroutedNumbers: (inboundNumbers?.length || 0) + (outboundNumbers?.length || 0),
    resynced,
  });
}
