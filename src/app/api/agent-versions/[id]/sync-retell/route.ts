import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient, flowToRetellPrompt, flowToRetellTools } from '@/lib/retell';
import type { FlowNode, GlobalSettings } from '@/types';
import { authorizeResource } from '@/lib/authz';

// POST /api/agent-versions/[id]/sync-retell — pushes an agent version's flow
// to Retell as a flattened prompt on that version's own retell_llm_id.
// Scoped to a version, not a tenant, because a version is the actual unit
// that carries voice_engine/flow_id/retell_llm_id since the
// calldesk_agents/calldesk_agent_versions migration — a tenant can have
// several agents, each with several versions, each independently synced.
// No-ops (not an error) for a poc-engine version, since call-loop-poc reads
// the flow directly at call time and has nothing to sync to.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_agent_versions', (await params).id);
  if (!__auth.ok) return __auth.response;

  try {
    const { id: versionId } = await params;
    const supabase = getSupabaseAdmin();

    const { data: version, error: versionError } = await supabase
      .from('calldesk_agent_versions')
      .select('*')
      .eq('id', versionId)
      .single();
    if (versionError || !version) {
      return NextResponse.json({ error: 'Agent version not found' }, { status: 404 });
    }

    if (version.voice_engine === 'poc') {
      return NextResponse.json({ synced: false, reason: 'poc engine reads the flow directly, nothing to sync' });
    }

    if (!version.retell_llm_id) {
      return NextResponse.json({ error: 'This version has no retell_llm_id to update' }, { status: 400 });
    }
    if (!version.flow_id) {
      return NextResponse.json({ error: 'This version has no flow to sync' }, { status: 400 });
    }

    const { data: flow, error: flowError } = await supabase
      .from('calldesk_conversation_flows')
      .select('*')
      .eq('id', version.flow_id)
      .single();
    if (flowError || !flow) {
      return NextResponse.json({ error: 'Flow not found' }, { status: 404 });
    }

    // Best-effort: pick up any knowledge base already synced to Retell for
    // this same agent. Multiple KBs per agent aren't deduplicated/merged
    // here — this mirrors the single-KB assumption the old tenant-scoped
    // route made, just re-pointed at agent_id instead of tenant_id.
    const { data: knowledgeBases } = await supabase
      .from('calldesk_knowledge_bases')
      .select('retell_kb_id')
      .eq('agent_id', flow.agent_id)
      .not('retell_kb_id', 'is', null);
    const knowledgeBaseIds = (knowledgeBases || [])
      .map((kb) => kb.retell_kb_id as string | null)
      .filter((id): id is string => Boolean(id));

    const flowObj = {
      id: flow.id,
      tenantId: flow.tenant_id,
      name: flow.name,
      nodes: flow.nodes as unknown as FlowNode[],
      globalSettings: flow.global_settings as unknown as GlobalSettings,
      isActive: flow.is_active,
      version: flow.version,
      createdAt: new Date(flow.created_at),
      updatedAt: new Date(flow.updated_at),
    };
    const prompt = flowToRetellPrompt(flowObj);
    const generalTools = flowToRetellTools(flowObj);

    const retell = getRetellClient();
    await retell.updateLLM(version.retell_llm_id, {
      generalPrompt: prompt,
      knowledgeBaseIds: knowledgeBaseIds.length > 0 ? knowledgeBaseIds : undefined,
      generalTools: generalTools.length > 0 ? generalTools : undefined,
    });

    return NextResponse.json({ synced: true });
  } catch (error) {
    console.error('Error syncing agent version to Retell:', error);
    const message = error instanceof Error ? error.message : 'Failed to sync to Retell';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
