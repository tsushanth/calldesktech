// Text-only port of the node-based conversation flow engine that voice calls
// run (see realtime-tts/call-loop-poc/server.js — the CallSession class).
// SAME state machine: a flow is a graph of nodes, each turn is scoped to just
// the current node's own prompt + its real edges (surfaced to Claude as a
// `transition_flow` tool whose enum is the node's actual targets), and the
// model advances state by calling that tool rather than us parsing its prose.
//
// What's stripped vs voice, because there is no live audio here:
//   - No Deepgram STT, no TTS, no sentence chunking, no barge-in, no turn
//     retirement bookkeeping — a text turn is a plain request/response.
//   - A `transfer` node can't redirect anything (there's no live call), so it
//     delivers its message and ends the session, same terminal shape as
//     goodbye. (Noted as a simplification.)
// What's preserved (the "real thing"): per-node prompting, the transition
// tool, extraction/collectedData, auto-advance node types (function /
// knowledge_base / goodbye / transfer act on entry), real webhook calls for
// function nodes, and real Supabase knowledge-base lookups for KB nodes.
//
// Unlike voice, this engine is stateless across turns: the machine's position
// (currentNodeId + collectedData) and the running message history are handed
// in on every call and handed back out, so they can be persisted on the chat
// session row between HTTP requests.

import type { FlowNode } from '@/types';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
// Match the voice path's default (Haiku) — a chat reply doesn't need more
// reasoning depth than a spoken one, and it keeps cost/latency low. Override
// with CHAT_LLM_MODEL, or fall back to the shared LLM_MODEL if set.
const LLM_MODEL =
  process.env.CHAT_LLM_MODEL || process.env.LLM_MODEL || 'claude-haiku-4-5-20251001';

// Node types that act the moment the flow enters them rather than waiting for
// the visitor to type something first — mirrors AUTO_ADVANCE_TYPES in
// server.js exactly.
const AUTO_ADVANCE_TYPES = new Set(['function', 'knowledge_base', 'goodbye', 'transfer']);
// Terminal node types: once their turn is delivered, the chat session is over.
const TERMINAL_TYPES = new Set(['goodbye', 'transfer']);
// Guards against a malformed flow (e.g. a cycle of auto-advance nodes) pinning
// a single HTTP request open forever.
const MAX_AUTO_ADVANCE_HOPS = 8;

export interface EngineFlow {
  nodes: FlowNode[];
  startNodeId: string;
  globalSettings?: Record<string, unknown>;
}

export interface EngineState {
  currentNodeId: string;
  collectedData: Record<string, string>;
}

export interface EngineMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TurnResult {
  // Assistant messages produced this turn — usually one, but an auto-advance
  // chain (e.g. greeting -> knowledge_base -> goodbye) can produce several.
  assistantMessages: string[];
  state: EngineState;
  // True once the flow has reached a terminal node — the caller should close
  // the session and stop accepting further input.
  ended: boolean;
}

// Fallback assistant used when a tenant has no flow at all — a single
// prompt-only receptionist, no state machine. Kept deliberately simple.
export const FALLBACK_SYSTEM_PROMPT =
  'You are a friendly, concise assistant for a small business, chatting with a ' +
  'website visitor. Answer their questions helpfully in 1-3 short sentences. If ' +
  'you do not know something, say so and offer to have someone follow up.';

function nodesById(flow: EngineFlow): Map<string, FlowNode> {
  return new Map(flow.nodes.map((n) => [n.id, n]));
}

// Port of _buildNodeSystemPrompt — the only wording change is "chatting with a
// website visitor" / "typed" instead of the voice-specific "on a phone call" /
// "spoken audio", and markdown is allowed since this renders as text.
function buildNodeSystemPrompt(
  node: FlowNode,
  flow: EngineFlow,
  collectedData: Record<string, string>
): string {
  let prompt =
    `You are a concise, friendly assistant chatting with a website visitor, currently in the ` +
    `"${node.id}" step of a structured conversation flow.\n\n` +
    `Step instructions: ${node.prompt}\n`;
  if (node.extract) {
    prompt += `Collect these fields before moving on, asking for whichever are still missing: ${Object.keys(node.extract).join(', ')}.\n`;
  }
  if (Object.keys(collectedData).length > 0) {
    prompt += `Already collected this chat: ${JSON.stringify(collectedData)}\n`;
  }
  if (node.edges.length > 0) {
    prompt +=
      `\nWhen this step's goal has been met, call the transition_flow tool to move to the ` +
      `next step. If it hasn't been met yet, keep chatting and don't call the tool.\n`;
  }
  prompt +=
    'Keep replies to 1-3 short sentences unless asked for more detail. Always say at least ' +
    'one sentence on every turn, even if you are also calling a tool — never respond with nothing.';
  return prompt;
}

// Port of _buildTransitionTool.
function buildTransitionTool(node: FlowNode) {
  const properties: Record<string, unknown> = {
    next_node_id: {
      type: 'string',
      enum: node.edges.map((e) => e.target),
      description: node.edges.map((e) => `${e.target}: ${e.condition}`).join('; '),
    },
  };
  if (node.extract) {
    properties.extracted = {
      type: 'object',
      properties: Object.fromEntries(Object.keys(node.extract).map((k) => [k, { type: 'string' }])),
      description: 'Fields the visitor has actually provided during this step so far.',
    };
  }
  return {
    name: 'transition_flow',
    description: "Call this once this step's goal has been met and it's time to move to the next step in the flow.",
    input_schema: { type: 'object', properties, required: ['next_node_id'] },
  };
}

interface ClaudeTurn {
  text: string;
  transition: { next_node_id: string; extracted?: Record<string, string> } | null;
}

// One call to Claude's Messages API (raw fetch — the app has no Anthropic SDK
// dependency, and a non-streaming request is all a text turn needs).
async function callClaude(
  system: string,
  messages: EngineMessage[],
  tools: ReturnType<typeof buildTransitionTool>[] | undefined
): Promise<ClaudeTurn> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  // Coalesce consecutive same-role turns into one message. An auto-advance
  // chain persists several assistant messages in a row, which the rebuilt
  // history then carries; merging keeps the request valid whatever the API's
  // alternation strictness, and reads to the model as one continuous turn.
  const merged: EngineMessage[] = [];
  for (const m of messages) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) prev.content = `${prev.content}\n\n${m.content}`;
    else merged.push({ role: m.role, content: m.content });
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 400,
      system,
      messages: merged,
      ...(tools ? { tools } : {}),
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const body = (await res.json()) as {
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; name: string; input: Record<string, unknown> }
    >;
  };

  let text = '';
  let transition: ClaudeTurn['transition'] = null;
  for (const block of body.content || []) {
    if (block.type === 'text') text += block.text;
    else if (block.type === 'tool_use' && block.name === 'transition_flow') {
      transition = block.input as ClaudeTurn['transition'];
    }
  }
  return { text: text.trim(), transition };
}

// Runs a flow 'function' node's configured webhook and folds the result into
// history as a system note — port of _executeFunctionNode.
async function executeFunctionNode(node: FlowNode, collectedData: Record<string, string>, history: EngineMessage[]) {
  const url = node.params?.webhookUrl;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ function: node.function, collectedData }),
      signal: AbortSignal.timeout(8000),
    });
    const result = await res.json().catch(() => ({}));
    history.push({
      role: 'user',
      content: `[System note: function "${node.function}" returned ${JSON.stringify(result)}]`,
    });
  } catch {
    history.push({
      role: 'user',
      content: `[System note: function "${node.function}" failed — let the visitor know something went wrong and offer to have someone follow up]`,
    });
  }
}

// Real knowledge-base lookup for a knowledge_base node — port of
// _executeKnowledgeBaseNode. The KB id is stamped onto the node's params by
// resolveTenantChatFlow (mirroring tenantLookup.js's attachKnowledgeBaseIds).
async function executeKnowledgeBaseNode(
  node: FlowNode,
  history: EngineMessage[],
  fetchKnowledgeItems: (kbId: string) => Promise<Array<{ question: string; answer: string }>>
) {
  const knowledgeBaseId = node.params?.knowledgeBaseId;
  if (!knowledgeBaseId) return;
  const items = await fetchKnowledgeItems(knowledgeBaseId);
  if (items.length === 0) return;
  const qa = items.map((it, i) => `${i + 1}. Q: ${it.question}\n   A: ${it.answer}`).join('\n');
  history.push({
    role: 'user',
    content: `[System note: knowledge base content for this step — answer using these facts when relevant, otherwise say you're not sure and offer to have someone follow up:\n${qa}]`,
  });
}

interface RunOptions {
  fetchKnowledgeItems?: (kbId: string) => Promise<Array<{ question: string; answer: string }>>;
}

// Generates one assistant turn for a node and returns its text + any
// transition the model requested. Port of the core of _generateTurn.
async function generateNodeTurn(
  node: FlowNode | null,
  flow: EngineFlow | null,
  history: EngineMessage[],
  collectedData: Record<string, string>,
  suppressTransitionTool: boolean
): Promise<ClaudeTurn> {
  const system = node && flow ? buildNodeSystemPrompt(node, flow, collectedData) : FALLBACK_SYSTEM_PROMPT;
  const tools =
    node && node.edges.length > 0 && !suppressTransitionTool ? [buildTransitionTool(node)] : undefined;

  const turn = await callClaude(system, history, tools);

  // Safety net for a terminal node that returned no text — mirrors the voice
  // engine's fallback to the node's own prompt text so the visitor's last
  // message is never dead air.
  if (!turn.text && node && (node.type === 'goodbye' || node.type === 'transfer')) {
    turn.text = node.prompt;
  }
  return turn;
}

// Ensures the history ends on a user message before we ask for an assistant
// turn (Anthropic prefills instead of replying if the last message is
// assistant). Auto-advance node entries have no real user utterance, so we
// seed a synthetic one — the same trick server.js uses with "[Call connected]".
function seedIfNeeded(history: EngineMessage[], node: FlowNode) {
  const last = history[history.length - 1];
  if (!last || last.role === 'assistant') {
    const label =
      node.type === 'goodbye'
        ? '[The visitor is done — wrap up and say goodbye.]'
        : node.type === 'transfer'
          ? '[Hand the visitor off to a team member.]'
          : '[Continue the flow.]';
    history.push({ role: 'user', content: label });
  }
}

// Enters a node and (if it's an auto-advance type) keeps walking the flow,
// generating a turn per node, until it lands on a node that waits for visitor
// input or a terminal node. Collects every assistant message produced.
// Port of _runNodeTurn + _applyTransition's auto-advance recursion, flattened
// into a bounded loop.
async function autoAdvance(
  startNodeId: string,
  flow: EngineFlow,
  byId: Map<string, FlowNode>,
  history: EngineMessage[],
  collectedData: Record<string, string>,
  assistantMessages: string[],
  opts: RunOptions
): Promise<{ currentNodeId: string; ended: boolean }> {
  let nodeId = startNodeId;
  for (let hop = 0; hop < MAX_AUTO_ADVANCE_HOPS; hop++) {
    const node = byId.get(nodeId);
    if (!node) return { currentNodeId: nodeId, ended: false };

    // Node entry side effects (once per entry), then generate the node's turn.
    if (node.type === 'function') await executeFunctionNode(node, collectedData, history);
    if (node.type === 'knowledge_base' && opts.fetchKnowledgeItems) {
      await executeKnowledgeBaseNode(node, history, opts.fetchKnowledgeItems);
    }
    seedIfNeeded(history, node);

    const turn = await generateNodeTurn(node, flow, history, collectedData, false);
    if (turn.text) {
      assistantMessages.push(turn.text);
      history.push({ role: 'assistant', content: turn.text });
    }

    if (TERMINAL_TYPES.has(node.type)) return { currentNodeId: nodeId, ended: true };

    if (!turn.transition) return { currentNodeId: nodeId, ended: false };
    if (turn.transition.extracted && typeof turn.transition.extracted === 'object') {
      Object.assign(collectedData, turn.transition.extracted);
    }
    const nextNode = byId.get(turn.transition.next_node_id);
    if (!nextNode) return { currentNodeId: nodeId, ended: false };

    if (AUTO_ADVANCE_TYPES.has(nextNode.type)) {
      nodeId = nextNode.id; // keep walking
    } else {
      // Non-auto node: it waits for the visitor's next message, exactly like
      // voice sets currentNodeId without running the node's turn yet.
      return { currentNodeId: nextNode.id, ended: false };
    }
  }
  return { currentNodeId: nodeId, ended: false };
}

// The chat's opening turn — generates the start node's greeting with the
// transition tool suppressed (there's no visitor utterance to justify a
// transition yet), mirroring _runNodeTurn's isCallOpening path.
// (No RunOptions here, unlike runUserTurn: the opening turn only ever runs the
// start node — always a non-auto greeting — so it never reaches a KB/function
// side effect that would need one.)
export async function runOpeningTurn(flow: EngineFlow | null): Promise<TurnResult> {
  const assistantMessages: string[] = [];
  if (!flow) {
    // Prompt-only fallback: no flow, no state machine — just a greeting.
    const history: EngineMessage[] = [{ role: 'user', content: '[A visitor just opened the chat. Greet them.]' }];
    const turn = await generateNodeTurn(null, null, history, {}, true);
    if (turn.text) assistantMessages.push(turn.text);
    return { assistantMessages, state: { currentNodeId: '', collectedData: {} }, ended: false };
  }

  const byId = nodesById(flow);
  const startNode = byId.get(flow.startNodeId) || flow.nodes[0];
  const history: EngineMessage[] = [{ role: 'user', content: '[The chat just started — begin the flow.]' }];

  const turn = await generateNodeTurn(startNode, flow, history, {}, true);
  if (turn.text) assistantMessages.push(turn.text);

  return {
    assistantMessages,
    state: { currentNodeId: startNode.id, collectedData: {} },
    ended: TERMINAL_TYPES.has(startNode.type),
  };
}

// A visitor turn: generate the current node's response, then apply any
// transition (auto-advancing through act-on-entry nodes). `history` must be
// the full prior conversation (visitor + assistant messages); `userText` is
// the new visitor message (already appended is NOT required — pass it
// separately). Port of _onUserTurnComplete -> _generateTurn -> _applyTransition.
export async function runUserTurn(
  flow: EngineFlow | null,
  state: EngineState,
  history: EngineMessage[],
  userText: string,
  opts: RunOptions = {}
): Promise<TurnResult> {
  const assistantMessages: string[] = [];
  const collectedData = { ...(state.collectedData || {}) };
  const workingHistory: EngineMessage[] = [...history, { role: 'user', content: userText }];

  // Prompt-only fallback path.
  if (!flow || !state.currentNodeId) {
    const turn = await generateNodeTurn(null, null, workingHistory, collectedData, true);
    if (turn.text) assistantMessages.push(turn.text);
    return { assistantMessages, state: { currentNodeId: '', collectedData }, ended: false };
  }

  const byId = nodesById(flow);
  const node = byId.get(state.currentNodeId) || byId.get(flow.startNodeId) || flow.nodes[0];

  const turn = await generateNodeTurn(node, flow, workingHistory, collectedData, false);
  if (turn.text) {
    assistantMessages.push(turn.text);
    workingHistory.push({ role: 'assistant', content: turn.text });
  }

  if (TERMINAL_TYPES.has(node.type)) {
    return { assistantMessages, state: { currentNodeId: node.id, collectedData }, ended: true };
  }

  if (!turn.transition) {
    return { assistantMessages, state: { currentNodeId: node.id, collectedData }, ended: false };
  }
  if (turn.transition.extracted && typeof turn.transition.extracted === 'object') {
    Object.assign(collectedData, turn.transition.extracted);
  }
  const nextNode = byId.get(turn.transition.next_node_id);
  if (!nextNode) {
    return { assistantMessages, state: { currentNodeId: node.id, collectedData }, ended: false };
  }

  if (AUTO_ADVANCE_TYPES.has(nextNode.type)) {
    const result = await autoAdvance(nextNode.id, flow, byId, workingHistory, collectedData, assistantMessages, opts);
    return { assistantMessages, state: { currentNodeId: result.currentNodeId, collectedData }, ended: result.ended };
  }

  // Non-auto next node just becomes current; its own prompt kicks in on the
  // visitor's next message (same one-turn handoff voice uses).
  return { assistantMessages, state: { currentNodeId: nextNode.id, collectedData }, ended: false };
}
