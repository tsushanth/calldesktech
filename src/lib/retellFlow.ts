// Converts a CallDesk flow graph into a Retell conversation-flow and creates
// the matching Retell agent. Dependency-free on purpose (plain fetch) so it
// can run from an API route or a script.
//
// Fidelity notes: `extraction` steps become conversation nodes with the
// fields to collect written into the instruction (Retell separates asking
// from extracting); `sms` becomes a spoken line (no SMS node); subflows are
// inlined; code / mcp / subagent / payment / agent_transfer / extract_variable
// have no direct Retell equivalent and become placeholder conversation nodes
// (reported in `warnings`).

type Edge = { id?: string; target: string; condition?: string | { field: string; operator: string; value: string } };
type Node = { id: string; type: string; prompt?: string; edges?: Edge[]; extract?: Record<string, string>; params?: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface RetellFlowInput {
  nodes: Node[];
  startNodeId: string;
  handbook?: string;
  defaultFunctionUrl?: string;
  knowledgeBaseIds?: string[];
  model?: string;
}

const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
const OPS: Record<string, string> = { '==': '==', '!=': '!=', '>': '>', '<': '<', '>=': '>=', '<=': '<=' };

function inlineSubflows(nodes: Node[], startNodeId: string, warnings: string[]): { nodes: Node[]; startNodeId: string } {
  const out: Node[] = [];
  const startMap = new Map<string, string>();
  for (const n of nodes) {
    if (n.type !== 'subflow_ref') continue;
    const sub = n.params?.subflowNodes as Node[] | undefined;
    const subStart = n.params?.subflowStartNodeId as string | undefined;
    if (!sub?.length || !subStart) { warnings.push(`subflow_ref "${n.id}" has no embedded nodes — dropped`); continue; }
    const prefix = `${n.id}__`;
    startMap.set(n.id, prefix + subStart);
    for (const s of sub) {
      out.push({ ...s, id: prefix + s.id, edges: (s.edges || []).map((e) => ({ ...e, target: prefix + e.target })) });
    }
  }
  const retarget = (id: string) => startMap.get(id) || id;
  for (const n of nodes) {
    if (n.type === 'subflow_ref') continue;
    out.push({ ...n, edges: (n.edges || []).map((e) => ({ ...e, target: retarget(e.target) })) });
  }
  return { nodes: out, startNodeId: retarget(startNodeId) };
}

export function toRetellFlow(input: RetellFlowInput) {
  const warnings: string[] = [];
  const { nodes: graph, startNodeId } = inlineSubflows(input.nodes, input.startNodeId, warnings);
  const tools: Record<string, unknown>[] = [];
  let firstEnd = graph.find((n) => n.type === 'goodbye')?.id;
  const nodes: Record<string, unknown>[] = [];
  // Retell requires a transfer_call node to name where to go if the transfer fails.
  if (!firstEnd && graph.some((n) => n.type === 'transfer')) {
    firstEnd = 'end_after_failed_transfer';
    nodes.push({ id: firstEnd, name: firstEnd, type: 'end', instruction: { type: 'prompt', text: 'Apologise that the transfer failed and end the call.' } });
  }
  const exists = new Set(graph.map((n) => n.id));

  const promptEdges = (n: Node) =>
    (n.edges || [])
      .filter((e) => exists.has(e.target))
      .map((e, i) => ({
        id: `${n.id}-e${i}`,
        transition_condition: { type: 'prompt', prompt: (typeof e.condition === 'string' && e.condition.trim() && e.condition !== 'always' ? e.condition : 'Continue') },
        destination_node_id: e.target,
      }));

  for (const n of graph) {
    const base = { id: n.id, name: n.id };
    const text = n.params?.spokenMessage?.trim() || n.prompt || '';
    switch (n.type) {
      case 'greeting':
      case 'extraction':
      case 'knowledge_base':
      case 'extract_variable': {
        const fields = n.extract && Object.keys(n.extract).length ? `\n\nDetails to collect from the caller before moving on: ${Object.keys(n.extract).join(', ')}.` : '';
        const kb = n.type === 'knowledge_base' ? '\n\nAnswer using the knowledge base.' : '';
        if (n.type === 'extract_variable') warnings.push(`"${n.id}": silent extract_variable approximated as a conversation step`);
        nodes.push({ ...base, type: 'conversation', instruction: { type: n.params?.spokenMessage ? 'static_text' : 'prompt', text: text + fields + kb }, edges: promptEdges(n) });
        break;
      }
      case 'function': {
        const toolId = `tool-${safe(n.id)}`;
        tools.push({
          type: 'custom', tool_id: toolId, name: safe(n.id).replace(/-/g, '_'), description: n.prompt || `Run ${n.id}`,
          url: n.params?.webhookUrl || input.defaultFunctionUrl || 'https://httpbin.org/get', method: 'GET', timeout_ms: 10000,
          speak_during_execution: false, speak_after_execution: true,
        });
        const e = promptEdges(n);
        nodes.push({ ...base, type: 'function', tool_type: 'local', tool_id: toolId, wait_for_result: true, speak_during_execution: false, edges: e.slice(0, 1).map((x) => ({ ...x, transition_condition: { type: 'prompt', prompt: 'Once the function is called, transition to next node.' } })), ...(e[0] ? { else_edge: { id: `${n.id}-else`, transition_condition: { type: 'prompt', prompt: 'Else' }, destination_node_id: e[0].destination_node_id } } : {}) });
        break;
      }
      case 'goodbye':
        nodes.push({ ...base, type: 'end', instruction: { type: n.params?.spokenMessage ? 'static_text' : 'prompt', text: text || 'Say goodbye and end the call.' } });
        break;
      case 'transfer':
        nodes.push({
          ...base, type: 'transfer_call', transfer_destination: { type: 'predefined', number: n.params?.transferTo || '' },
          transfer_option: { type: 'cold_transfer', show_transferee_as_caller: false },
          instruction: { type: 'prompt', text: n.params?.spokenMessage || 'Transferring your call now.' },
          ...(firstEnd ? { edge: { id: `${n.id}-fail`, transition_condition: { type: 'prompt', prompt: 'Transfer failed' }, destination_node_id: firstEnd } } : {}),
        });
        break;
      case 'logic_split': {
        const edges: Record<string, unknown>[] = [];
        let elseEdge: Record<string, unknown> | undefined;
        (n.edges || []).forEach((e, i) => {
          if (!exists.has(e.target)) return;
          if (e.condition && typeof e.condition === 'object' && OPS[e.condition.operator]) {
            edges.push({ id: `${n.id}-e${i}`, destination_node_id: e.target, transition_condition: { type: 'equation', equations: [{ left: `{{${e.condition.field}}}`, operator: OPS[e.condition.operator], right: e.condition.value }], operator: '&&' } });
          } else elseEdge = { id: `${n.id}-else`, destination_node_id: e.target, transition_condition: { type: 'prompt', prompt: 'Else' } };
        });
        nodes.push({ ...base, type: 'branch', edges, ...(elseEdge ? { else_edge: elseEdge } : {}) });
        break;
      }
      case 'press_digit':
        nodes.push({ ...base, type: 'press_digit', instruction: { type: 'prompt', text: n.prompt || `Press ${n.params?.digits || 'the requested digits'}.` }, delay_ms: 1000, edges: promptEdges(n) });
        break;
      case 'sms': {
        warnings.push(`"${n.id}": sms approximated as a spoken line (Retell flows have no SMS node)`);
        const e = promptEdges(n)[0];
        nodes.push({ ...base, type: 'conversation', instruction: { type: 'static_text', text: 'I have sent you a text message with the details.' }, edges: [], ...(e ? { skip_response_edge: { id: `${n.id}-skip`, destination_node_id: e.destination_node_id, transition_condition: { type: 'prompt', prompt: 'Skip response' } } } : {}) });
        break;
      }
      case 'note':
        break;
      default: {
        warnings.push(`"${n.id}": ${n.type} has no Retell equivalent — placeholder conversation step`);
        nodes.push({ ...base, type: 'conversation', instruction: { type: 'prompt', text: text || `(${n.type} step)` }, edges: promptEdges(n) });
      }
    }
  }

  return {
    warnings,
    flow: {
      start_node_id: startNodeId,
      start_speaker: 'agent',
      global_prompt: input.handbook || '',
      model_choice: { type: 'cascading', model: input.model || 'claude-4.5-haiku' },
      nodes,
      tools,
      ...(input.knowledgeBaseIds?.length ? { knowledge_base_ids: input.knowledgeBaseIds } : {}),
    },
  };
}

async function retell(path: string, body: unknown, apiKey: string, form?: FormData) {
  const res = await fetch(`https://api.retellai.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, ...(form ? {} : { 'Content-Type': 'application/json' }) },
    body: form || JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Retell ${path} -> ${res.status} ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

export async function createRetellAgentFromFlow(opts: {
  apiKey: string; agentName: string; voiceId: string; input: RetellFlowInput;
  knowledgeBase?: { name: string; items: { question: string; answer: string }[] };
}) {
  const { flow, warnings } = toRetellFlow(opts.input);
  let kbId: string | undefined;
  if (opts.knowledgeBase?.items.length) {
    const form = new FormData();
    form.append('knowledge_base_name', opts.knowledgeBase.name.slice(0, 39));
    form.append('knowledge_base_texts', JSON.stringify(opts.knowledgeBase.items.map((i, k) => ({ title: `faq-${k + 1}`, text: `Q: ${i.question}\nA: ${i.answer}` }))));
    kbId = (await retell('/create-knowledge-base', null, opts.apiKey, form)).knowledge_base_id;
  }
  const created = await retell('/create-conversation-flow', { ...flow, ...(kbId ? { knowledge_base_ids: [kbId] } : {}) }, opts.apiKey);
  const agent = await retell('/create-agent', {
    agent_name: opts.agentName,
    voice_id: opts.voiceId,
    language: 'en-US',
    response_engine: { type: 'conversation-flow', conversation_flow_id: created.conversation_flow_id },
  }, opts.apiKey);
  return { agentId: agent.agent_id as string, conversationFlowId: created.conversation_flow_id as string, knowledgeBaseId: kbId, warnings };
}
