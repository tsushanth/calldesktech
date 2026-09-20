import { NextRequest } from 'next/server';
import { AGENT_TEMPLATES } from '@/lib/agentTemplates';
import { createRetellAgentFromFlow, retellVoiceFor } from '@/lib/retellFlow';
import { getSupabaseAdmin } from '@/lib/supabase';
import { POST as createAgentRoute } from '@/app/api/tenants/[id]/agents/route';
import { POST as createVersionRoute } from '@/app/api/agents/[id]/versions/route';
import { POST as createSubflowRoute } from '@/app/api/tenants/[id]/subflows/route';
import { POST as createKbRoute } from '@/app/api/tenants/[id]/knowledge-bases/route';
import { POST as addKbItemsRoute } from '@/app/api/knowledge-bases/[id]/items/route';
import type { FlowNode } from '@/types';
import { normalizeLanguage, AGENT_LANGUAGES } from '@/lib/languages';
import { collectPlaceholders, substituteVariables } from '@/lib/templateVariables';

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
  /** Agent language, e.g. "es", "fr", "pt-BR" (default English). Non-English agents use a multilingual voice. */
  language?: string;
  /** false turns off live calendar lookups and bookings for this agent (default: on when the workspace has a calendar). */
  calendarTools?: boolean;
  templateId: string;
  name?: string;
  voiceEngine: 'poc' | 'retell';
  /** Replaces empty transfer numbers in the template (E.164). */
  transferTo?: string;
  /** Replaces empty function-node webhook URLs. */
  functionUrl?: string;
  /** Values for the template's {{placeholders}}, e.g. { business_name, agent_name }. Override defaults and the tenant name. */
  variables?: Record<string, string>;
}

/** {{placeholders}} a template uses, excluding names its own extraction fields produce. */
function templatePlaceholders(t: (typeof AGENT_TEMPLATES)[number]): string[] {
  const used = new Set<string>();
  const produced = new Set<string>();
  const scan = (nodes: FlowNode[]) => {
    for (const n of nodes) {
      Object.keys(n.extract || {}).forEach((k) => produced.add(k.toLowerCase()));
      const { _templateSubflowSeed, _templateKnowledgeBaseSeed, ...rest } = (n.params || {}) as Record<string, string>;
      collectPlaceholders({ prompt: n.prompt, edges: n.edges, params: rest }, used);
      if (_templateKnowledgeBaseSeed) collectPlaceholders(JSON.parse(_templateKnowledgeBaseSeed), used);
      if (_templateSubflowSeed) {
        const seed = JSON.parse(_templateSubflowSeed) as { nodes: FlowNode[] };
        scan(seed.nodes);
      }
    }
  };
  scan(t.nodes);
  collectPlaceholders(t.handbook, used);
  return [...used].filter((k) => !produced.has(k)).sort();
}

export function listTemplates() {
  return AGENT_TEMPLATES.map((t) => ({
    id: t.id, label: t.label, description: t.description, category: t.category,
    defaultVariables: t.defaultVariables || {},
    variables: templatePlaceholders(t),
  }));
}

async function tenantName(tenantId: string): Promise<string | undefined> {
  const { data } = await getSupabaseAdmin().from('calldesk_tenants').select('name').eq('id', tenantId).maybeSingle();
  const name = (data as { name?: string } | null)?.name?.trim();
  return name || undefined;
}

export async function installTemplate(req: NextRequest, tenantId: string, opts: InstallOptions) {
  const template = AGENT_TEMPLATES.find((t) => t.id === opts.templateId);
  if (!template) throw new Error(`Unknown template "${opts.templateId}"`);
  const label = opts.name?.trim() || template.label;
  const language = normalizeLanguage(opts.language);
  if (!language) throw new Error(`Unsupported language "${opts.language}"`);
  const retellLang = AGENT_LANGUAGES.find((l) => l.code === language)?.retell;

  // Defaults < tenant name (as business_name, when the template has that concept) < explicit variables.
  const defaults = template.defaultVariables || {};
  const explicit = opts.variables || {};
  const variables: Record<string, string> = { ...defaults };
  if ('business_name' in defaults) {
    const tn = await tenantName(tenantId).catch(() => undefined);
    if (tn) variables.business_name = tn;
  }
  Object.assign(variables, explicit);
  // A shorter form of the business name (e.g. "Retell Care") follows business_name unless set explicitly.
  if ('business_short_name' in defaults && !explicit.business_short_name && variables.business_name !== defaults.business_name) {
    variables.business_short_name = variables.business_name;
  }

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
        const rawSeed = JSON.parse(p._templateKnowledgeBaseSeed) as { name: string; items: { question: string; answer: string }[] };
        // On our engine the stored text keeps its {{placeholders}} and the engine fills them at answer time,
        // so changing a variable later takes effect. Retell has no such variables, so its copy is resolved now.
        const seed = opts.voiceEngine === 'retell'
          ? { name: substituteVariables(rawSeed.name, variables), items: rawSeed.items.map((i) => ({ question: substituteVariables(i.question, variables), answer: substituteVariables(i.answer, variables) })) }
          : { name: substituteVariables(rawSeed.name, variables), items: rawSeed.items };
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
        apiKey, agentName: label, voiceId: retellVoiceFor(language), language: retellLang,
        knowledgeBase: kbSeed && { name: `${label}-kb`, items: kbSeed.items },
        input: { nodes: nodes.map((n) => (subflowSeeds[n.id] ? ({ ...n, params: { subflowNodes: subflowSeeds[n.id].nodes, subflowStartNodeId: subflowSeeds[n.id].startNodeId } } as unknown as FlowNode) : n)), startNodeId: template.startNodeId, handbook: template.handbook, defaultFunctionUrl: opts.functionUrl, variables, languageName: AGENT_LANGUAGES.find((l) => l.code === language)?.label },
      });
      retell = { agentId: r.agentId, warnings: r.warnings };
    }

    const { version } = await json<{ version: { id: string; version_number: number } }>(
      await createVersionRoute(
        withBody(req, `/api/agents/${agent.id}/versions`, {
          flowName: template.id, startNodeId: template.startNodeId, nodes,
          voiceEngine: opts.voiceEngine,
          ...(retell ? { retellAgentId: retell.agentId } : {}),
          globalSettings: { ...(template.handbook ? { handbook: template.handbook } : {}), ...(Object.keys(variables).length ? { variables } : {}), ...(opts.calendarTools === false ? { calendarTools: false } : {}), ...(language !== 'en' ? { language } : {}) },
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
