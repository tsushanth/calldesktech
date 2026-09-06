// Resolves which flow a tenant's text chat should run — the chat-channel
// analogue of call-loop-poc/tenantLookup.js's resolveInboundCall, but keyed on
// tenant (a chat widget is embedded per tenant) instead of a dialed number.
//
// A chat pins to the tenant's newest agent VERSION and that version's flow,
// exactly like a voice call pins to a phone number's inbound version + flow.
// Unlike voice we don't filter on voice_engine: the flow graph is engine-
// agnostic (it's the same nodes whether spoken or typed), so a 'retell' or
// 'poc' version's flow both drive the text engine fine. When the tenant has no
// agent version or no flow, we return a null flow and the engine falls back to
// a single prompt-only assistant.

import { getSupabaseAdmin } from '@/lib/supabase';
import type { FlowNode } from '@/types';
import type { EngineFlow } from '@/lib/textFlowEngine';

export interface ResolvedChatFlow {
  agentVersionId: string | null;
  flow: EngineFlow | null;
}

// A knowledge_base node has no column for which KB it reads — that lives on
// calldesk_knowledge_bases via agent_id. Stamp the real id onto each such node
// so textFlowEngine's KB lookup has something to query. Port of
// tenantLookup.js's attachKnowledgeBaseIds.
async function attachKnowledgeBaseIds(nodes: FlowNode[], agentId: string | null): Promise<FlowNode[]> {
  if (!agentId || !nodes.some((n) => n.type === 'knowledge_base')) return nodes;
  const supabase = getSupabaseAdmin();
  const { data: kbs } = await supabase
    .from('calldesk_knowledge_bases')
    .select('id')
    .eq('agent_id', agentId)
    .limit(1);
  const knowledgeBaseId = kbs?.[0]?.id;
  if (!knowledgeBaseId) return nodes;
  return nodes.map((n) =>
    n.type === 'knowledge_base' ? { ...n, params: { ...(n.params || {}), knowledgeBaseId } } : n
  );
}

export async function resolveTenantChatFlow(tenantId: string): Promise<ResolvedChatFlow> {
  const supabase = getSupabaseAdmin();

  // Newest agent for the tenant, then its newest version.
  const { data: agent } = await supabase
    .from('calldesk_agents')
    .select('id')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!agent) return { agentVersionId: null, flow: null };

  const { data: version } = await supabase
    .from('calldesk_agent_versions')
    .select('id, flow_id, agent_id')
    .eq('agent_id', agent.id)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!version) return { agentVersionId: null, flow: null };
  if (!version.flow_id) return { agentVersionId: version.id, flow: null };

  const { data: flowRow } = await supabase
    .from('calldesk_conversation_flows')
    .select('nodes, global_settings')
    .eq('id', version.flow_id)
    .maybeSingle();

  const nodes = (flowRow?.nodes as FlowNode[] | undefined) || [];
  if (nodes.length === 0) return { agentVersionId: version.id, flow: null };

  const globalSettings = (flowRow?.global_settings as Record<string, unknown> | undefined) || {};
  const withKb = await attachKnowledgeBaseIds(nodes, version.agent_id);

  return {
    agentVersionId: version.id,
    flow: {
      nodes: withKb,
      startNodeId: (globalSettings.startNodeId as string) || withKb[0].id,
      globalSettings,
    },
  };
}

// Real Q&A retrieval for a knowledge_base node — port of tenantLookup.js's
// fetchKnowledgeItems. No embeddings/semantic search, just the KB's actual
// content handed to the model to pick from, bounded like the voice path.
export async function fetchKnowledgeItems(
  knowledgeBaseId: string
): Promise<Array<{ question: string; answer: string }>> {
  if (!knowledgeBaseId) return [];
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('calldesk_knowledge_items')
    .select('question, answer')
    .eq('knowledge_base_id', knowledgeBaseId)
    .limit(50);
  return data || [];
}
