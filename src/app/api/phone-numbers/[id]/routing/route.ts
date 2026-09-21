import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeResource, belongsToTenant } from '@/lib/authz';

// POST /api/phone-numbers/[id]/routing — points a phone number's inbound or
// outbound slot at a specific agent version, OR at an environment (see
// migration 036 — staging/production; promoting a new version into an
// environment takes effect for every number routed to it with no further
// call to this route). Pass exactly one of agentVersionId or environmentId;
// pass agentVersionId: null to disable a direction (e.g. turn outbound
// off) — environment routing has no separate "disable", route to null to
// clear it the same way. For a retell-engine version's inbound slot, also
// pushes the flow to Retell as a flattened prompt — no-op for poc engine.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_phone_numbers', (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: phoneNumberId } = await params;
  const supabase = getSupabaseAdmin();
  const { direction, agentVersionId, environmentId } = await request.json();
  if (agentVersionId && environmentId) {
    return NextResponse.json({ error: 'Pass agentVersionId or environmentId, not both' }, { status: 400 });
  }
  if (agentVersionId && __auth.tenantId && !(await belongsToTenant('calldesk_agent_versions', agentVersionId, __auth.tenantId))) {
    return NextResponse.json({ error: 'agentVersionId not found' }, { status: 404 });
  }

  if (direction !== 'inbound' && direction !== 'outbound') {
    return NextResponse.json({ error: 'direction must be "inbound" or "outbound"' }, { status: 400 });
  }

  let resolvedVersionId: string | null = agentVersionId ?? null;
  const envColumn = direction === 'inbound' ? 'inbound_environment_id' : 'outbound_environment_id';
  const update: Record<string, string | null> = { [envColumn]: null };

  if (environmentId) {
    const { data: environment } = await supabase
      .from('calldesk_agent_environments')
      .select('id, version_id, calldesk_agents!inner(tenant_id)')
      .eq('id', environmentId)
      .single();
    const environmentTenantId = (environment as unknown as { calldesk_agents?: { tenant_id?: string } } | null)?.calldesk_agents?.tenant_id;
    if (!environment || environmentTenantId !== __auth.tenantId) {
      return NextResponse.json({ error: 'environmentId not found' }, { status: 404 });
    }
    update[envColumn] = environmentId;
    resolvedVersionId = environment.version_id;
  }

  const column = direction === 'inbound' ? 'inbound_agent_version_id' : 'outbound_agent_version_id';
  update[column] = resolvedVersionId;

  const { data: phoneNumber, error } = await supabase
    .from('calldesk_phone_numbers')
    .update(update)
    .eq('id', phoneNumberId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (direction !== 'inbound' || !resolvedVersionId) {
    return NextResponse.json({ phoneNumber, syncedToRetell: false });
  }

  const { data: version } = await supabase
    .from('calldesk_agent_versions')
    .select('voice_engine')
    .eq('id', resolvedVersionId)
    .single();
  if (version?.voice_engine !== 'retell') {
    return NextResponse.json({ phoneNumber, syncedToRetell: false });
  }

  try {
    const res = await fetch(`${request.nextUrl.origin}/api/agent-versions/${resolvedVersionId}/sync-retell`, {
      method: 'POST',
      // The sync route is authenticated now — forward this caller's own credentials.
      headers: {
        cookie: request.headers.get('cookie') || '',
        authorization: request.headers.get('authorization') || '',
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: body.error || `sync route returned HTTP ${res.status}` }, { status: 500 });
    }
    return NextResponse.json({ phoneNumber, syncedToRetell: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to sync to Retell';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
