import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import type { FlowNode } from '@/types';

// GET /api/agents/[id]/versions — list an agent's versions, newest first
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_agent_versions')
    .select('*')
    .eq('agent_id', agentId)
    .order('version_number', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ versions: data });
}

// POST /api/agents/[id]/versions — create a new, immutable version.
// Always creates a fresh calldesk_conversation_flows row (a version pins to
// one flow snapshot) plus the version row referencing it, auto-incrementing
// version_number. Mirrors the flow MCP server's create_agent_version tool —
// this is the UI path to the same operation, not a separate one.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params;
  const supabase = getSupabaseAdmin();
  const body = await request.json();
  const {
    flowName,
    startNodeId,
    nodes,
    globalSettings,
    voiceEngine,
    retellAgentId,
    retellLlmId,
    voiceId,
    ttsBackend,
    wizardConfig,
  } = body as {
    flowName: string;
    startNodeId: string;
    nodes: FlowNode[];
    globalSettings?: Record<string, unknown>;
    voiceEngine: 'retell' | 'poc';
    retellAgentId?: string;
    retellLlmId?: string;
    voiceId?: string;
    ttsBackend?: 'kokoro' | 'elevenlabs';
    wizardConfig?: Record<string, unknown>;
  };

  if (!flowName || !startNodeId || !Array.isArray(nodes) || nodes.length === 0) {
    return NextResponse.json(
      { error: 'flowName, startNodeId, and at least one node are required' },
      { status: 400 }
    );
  }
  const nodeIds = new Set(nodes.map((n) => n.id));
  if (!nodeIds.has(startNodeId)) {
    return NextResponse.json({ error: `startNodeId "${startNodeId}" is not one of the provided nodes' ids` }, { status: 400 });
  }
  for (const node of nodes) {
    for (const edge of node.edges) {
      if (!nodeIds.has(edge.target)) {
        return NextResponse.json(
          { error: `node "${node.id}" has an edge targeting unknown node "${edge.target}"` },
          { status: 400 }
        );
      }
    }
  }

  const { data: agent, error: agentError } = await supabase
    .from('calldesk_agents')
    .select('tenant_id')
    .eq('id', agentId)
    .single();
  if (agentError || !agent) {
    return NextResponse.json({ error: agentError?.message || 'Agent not found' }, { status: 404 });
  }

  const { data: flow, error: flowError } = await supabase
    .from('calldesk_conversation_flows')
    .insert({
      tenant_id: agent.tenant_id,
      agent_id: agentId,
      name: flowName,
      nodes,
      global_settings: { allowInterruptions: true, returnToFlow: true, startNodeId, ...globalSettings },
      is_active: false,
    })
    .select()
    .single();
  if (flowError) return NextResponse.json({ error: flowError.message }, { status: 500 });

  const { data: latest } = await supabase
    .from('calldesk_agent_versions')
    .select('version_number')
    .eq('agent_id', agentId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const versionNumber = (latest?.version_number || 0) + 1;

  const { data: version, error: versionError } = await supabase
    .from('calldesk_agent_versions')
    .insert({
      agent_id: agentId,
      version_number: versionNumber,
      voice_engine: voiceEngine || 'retell',
      flow_id: flow.id,
      retell_agent_id: retellAgentId || null,
      retell_llm_id: retellLlmId || null,
      voice_id: voiceId || null,
      tts_backend: ttsBackend || null,
      wizard_config: wizardConfig || null,
    })
    .select()
    .single();
  if (versionError) return NextResponse.json({ error: versionError.message }, { status: 500 });

  return NextResponse.json({ version, flow }, { status: 201 });
}
