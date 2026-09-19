import { NextRequest } from 'next/server';
import { AGENT_TEMPLATES } from '@/lib/agentTemplates';
import { createRetellAgentFromFlow } from '@/lib/retellFlow';
import { getSupabaseAdmin } from '@/lib/supabase';
import { POST as createAgentRoute } from '@/app/api/tenants/[id]/agents/route';
import { POST as createVersionRoute } from '@/app/api/agents/[id]/versions/route';
import { POST as createSubflowRoute } from '@/app/api/tenants/[id]/subflows/route';
import { POST as createKbRoute } from '@/app/api/tenants/[id]/knowledge-bases/route';
import { POST as addKbItemsRoute } from '@/app/api/knowledge-bases/[id]/items/route';
import type { FlowNode } from '@/types';

// Creates a ready-to-call agent from a built-in template through the same
// route handlers the dashboard uses, re-invoked in-process with the caller's
// own credentials so every authorization check still applies.

const withBody = (req: NextRequest, path: string, body: unknown) => {
  const headers = new Headers(req.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json');
  return new NextRequest(new URL(path, req.url), { method: 'POST', headers, body: JSON.stringify(body) });
};
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  return body as T;
}

export interface InstallOptions {
  templateId: string;
  name?: string;
  voiceEngine: 'poc' | 'retell';
  /** Replaces empty transfer numbers in the template (E.164). */
  transferTo?: string;
  /** Replaces empty function-node webhook URLs. */
  functionUrl?: string;
}

export function listTemplates() {
  return AGENT_TEMPLATES.map((t) => ({ id: t.id, label: t.label, description: t.description, category: t.category }));
}

export async function installTemplate(req: NextRequest, tenantId: string, opts: InstallOptions) {
  const template = AGENT_TEMPLATES.find((t) => t.id === opts.templateId);
  if (!template) throw new Error(`Unknown template "${opts.templateId}"`);
  const label = opts.name?.trim() || template.label;

  const { agent } = await json<{ agent: { id: string } }>(
    await createAgentRoute(withBody(req, `/api/tenants/${tenantId}/agents`, { name: label, mode: 'advanced' }), ctx(tenantId))
  );
  try {
    let kbSeed: { name: string; items: { question: string; answer: string }[] } | undefined;
    const nodes: FlowNode[] = [];
    const subflowSeeds: Record<string, { nodes: FlowNode[]; startNodeId: string }> = {};
    for (const original of JSON.parse(JSON.stringify(template.nodes)) as FlowNode[]) {
      const n = original;
      const p = n.params || {};
      if (n.type === 'subflow_ref' && p._templateSubflowSeed) {
        const seed = JSON.parse(p._templateSubflowSeed) as { name: string; nodes: FlowNode[]; startNodeId: string };
        seed.nodes = seed.nodes.map((sn) => {
          if (sn.type === 'transfer' && opts.transferTo) return { ...sn, params: { ...(sn.params || {}), transferTo: ((sn.params?.transferTo as string) || '').trim() || opts.transferTo } };
          if (sn.type === 'function' && opts.functionUrl) return { ...sn, params: { ...(sn.params || {}), webhookUrl: ((sn.params?.webhookUrl as string) || '').trim() || opts.functionUrl } };
          return sn;
        });
        subflowSeeds[n.id] = seed;
        const { subflow } = await json<{ subflow: { id: string } }>(
          await createSubflowRoute(withBody(req, `/api/tenants/${tenantId}/subflows`, { agentId: agent.id, scope: 'agent', name: seed.name, nodes: seed.nodes, startNodeId: seed.startNodeId }), ctx(tenantId))
        );
        n.params = { subflowId: subflow.id };
      }
      if (n.type === 'knowledge_base' && p._templateKnowledgeBaseSeed) {
        const seed = JSON.parse(p._templateKnowledgeBaseSeed) as { name: string; items: { question: string; answer: string }[] };
        if (opts.voiceEngine === 'retell') kbSeed = seed;
        const { knowledgeBase } = await json<{ knowledgeBase: { id: string } }>(
          await createKbRoute(withBody(req, `/api/tenants/${tenantId}/knowledge-bases`, { name: seed.name, source_type: 'manual', agent_id: agent.id }), ctx(tenantId))
        );
        await json(await addKbItemsRoute(withBody(req, `/api/knowledge-bases/${knowledgeBase.id}/items`, { items: seed.items }), ctx(knowledgeBase.id)));
        n.params = { knowledgeBaseId: knowledgeBase.id };
      }
      if (n.type === 'transfer' && opts.transferTo) {
        n.params = { ...(n.params || {}), transferTo: ((n.params?.transferTo as string) || '').trim() || opts.transferTo };
      }
      if (n.type === 'function' && opts.functionUrl) {
        n.params = { ...(n.params || {}), webhookUrl: ((n.params?.webhookUrl as string) || '').trim() || opts.functionUrl };
      }
      nodes.push(n);
    }

    let retell: { agentId: string; warnings: string[] } | undefined;
    if (opts.voiceEngine === 'retell') {
      const apiKey = process.env.RETELL_API_KEY;
      if (!apiKey) throw new Error('RETELL_API_KEY is not configured on this server');
      const r = await createRetellAgentFromFlow({
        apiKey, agentName: label, voiceId: 'retell-Cimo',
        knowledgeBase: kbSeed && { name: `${label}-kb`, items: kbSeed.items },
        input: { nodes: nodes.map((n) => (subflowSeeds[n.id] ? ({ ...n, params: { subflowNodes: subflowSeeds[n.id].nodes, subflowStartNodeId: subflowSeeds[n.id].startNodeId } } as unknown as FlowNode) : n)), startNodeId: template.startNodeId, handbook: template.handbook, defaultFunctionUrl: opts.functionUrl },
      });
      retell = { agentId: r.agentId, warnings: r.warnings };
    }

    const { version } = await json<{ version: { id: string; version_number: number } }>(
      await createVersionRoute(
        withBody(req, `/api/agents/${agent.id}/versions`, {
          flowName: template.id, startNodeId: template.startNodeId, nodes,
          voiceEngine: opts.voiceEngine,
          ...(retell ? { retellAgentId: retell.agentId } : {}),
          globalSettings: template.handbook ? { handbook: template.handbook } : {},
        }),
        ctx(agent.id)
      )
    );
    return { agentId: agent.id, versionId: version.id, versionNumber: version.version_number, template: template.id, voiceEngine: opts.voiceEngine, ...(retell ? { retellAgentId: retell.agentId, warnings: retell.warnings } : {}) };
  } catch (err) {
    await getSupabaseAdmin().from('calldesk_agents').delete().eq('id', agent.id);
    throw err;
  }
}
