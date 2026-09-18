import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

// GET /api/tenants/[id]/agents — list a tenant's agents, each enriched with
// its latest version's voice_engine/voice + any phone number routed to it.
// The agents list used to show almost nothing (name, mode, created date) —
// this fills in real columns from data that already exists elsewhere,
// rather than the page just re-fetching versions/numbers itself N times.
//
// Deliberately NOT included: an "Edited by" column. This app has no
// multi-user/team model at all — one owner per workspace, no invited
// teammates, no per-change attribution ever recorded — so a real "who
// edited this" value doesn't exist to show. lastUpdatedAt (the latest
// version's own created_at) is a real substitute for "when", just not
// "who"; building the "who" would mean building team accounts first.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();
  const { data: agents, error } = await supabase
    .from('calldesk_agents')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!agents || agents.length === 0) return NextResponse.json({ agents: [] });

  const agentIds = agents.map((a) => a.id);

  interface VersionRow {
    id: string;
    agent_id: string;
    version_number: number;
    voice_engine: string;
    voice_id: string | null;
    tts_backend: string | null;
    created_at: string;
  }
  interface NumberRow {
    number: string;
    inbound_agent_version_id: string | null;
    outbound_agent_version_id: string | null;
  }

  const [{ data: versionsRaw }, { data: numbersRaw }] = await Promise.all([
    supabase
      .from('calldesk_agent_versions')
      .select('id, agent_id, version_number, voice_engine, voice_id, tts_backend, created_at')
      .in('agent_id', agentIds)
      .order('version_number', { ascending: false }),
    supabase
      .from('calldesk_phone_numbers')
      .select('number, inbound_agent_version_id, outbound_agent_version_id')
      .eq('tenant_id', tenantId),
  ]);
  const versions: VersionRow[] = versionsRaw || [];
  const numbers: NumberRow[] = numbersRaw || [];

  // First row per agent_id is that agent's latest version — versions is
  // already ordered version_number desc above.
  const latestVersionByAgent = new Map<string, VersionRow>();
  for (const v of versions) {
    if (!latestVersionByAgent.has(v.agent_id)) latestVersionByAgent.set(v.agent_id, v);
  }

  // A phone number routes to a specific VERSION, not an agent directly —
  // map every version id this tenant's numbers reference back to its
  // owning agent id so "does any number point at any version of THIS
  // agent" is a simple lookup.
  const versionToAgent = new Map(versions.map((v) => [v.id, v.agent_id]));
  const phonesByAgent = new Map<string, Set<string>>();
  for (const n of numbers) {
    for (const versionId of [n.inbound_agent_version_id, n.outbound_agent_version_id]) {
      const agentId = versionId ? versionToAgent.get(versionId) : null;
      if (!agentId) continue;
      if (!phonesByAgent.has(agentId)) phonesByAgent.set(agentId, new Set());
      phonesByAgent.get(agentId)!.add(n.number);
    }
  }

  const enriched = agents.map((agent) => {
    const latest = latestVersionByAgent.get(agent.id) || null;
    return {
      ...agent,
      latestVersion: latest
        ? {
            voiceEngine: latest.voice_engine,
            voice: latest.voice_engine === 'poc' ? latest.tts_backend || 'kokoro' : latest.voice_id,
            updatedAt: latest.created_at,
          }
        : null,
      phoneNumbers: Array.from(phonesByAgent.get(agent.id) || []),
    };
  });

  return NextResponse.json({ agents: enriched });
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
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

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
