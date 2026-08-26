#!/usr/bin/env node
// MCP server for calldesktech's conversation-flow engine — lets an agent
// create/version/route agents and drive a headless test call against
// call-loop-poc's real flow engine, entirely without the dashboard UI. That
// UI doesn't exist yet; this is the interface used to build and verify the
// flow engine before investing in one.
//
// Data model (see the "Two-Tier Onboarding" design artifact for the full
// reasoning, and supabase/migrations/005_agents_and_versions.sql for the
// schema): a tenant has agents; an agent accumulates immutable versions as
// it's edited; a phone number's inbound/outbound slots each route to one
// specific agent version (mirrors Retell's own per-number Inbound/Outbound
// Call Agent dropdowns, including that inbound and outbound CAN point at
// different versions of the same agent). voice_engine lives on the version,
// not the tenant or the agent — it's what determines how that version's
// calls execute.
//
// Flow execution only ever happens in call-loop-poc (see its server.js) —
// a retell-engine version keeps its flattened-prompt-on-Retell's-LLM
// behavior (pushed via route_phone_number → the sync-retell API route)
// regardless of what's tested here. start_test_call/send_test_turn work
// against any version's flow directly, independent of both its
// voice_engine and whether any phone number is actually routed to it.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';
import { z } from 'zod';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CALLDESKTECH_BASE_URL = process.env.CALLDESKTECH_BASE_URL || 'http://localhost:3000';
const CALL_LOOP_WS_URL = process.env.CALL_LOOP_WS_URL || 'ws://localhost:8090/call';
const TEST_TURN_TIMEOUT_MS = 15000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[flow-mcp] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const server = new McpServer({ name: 'calldesktech-flow-mcp', version: '0.1.0' });

const flowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['greeting', 'extraction', 'function', 'knowledge_base', 'transfer', 'goodbye']),
  prompt: z.string(),
  extract: z.record(z.string()).optional(),
  function: z.string().optional(),
  params: z.record(z.string()).optional(),
  edges: z.array(z.object({ id: z.string(), condition: z.string(), target: z.string() })),
});

const globalSettingsSchema = z.object({
  allowInterruptions: z.boolean().optional(),
  returnToFlow: z.boolean().optional(),
  knowledgeBaseId: z.string().optional(),
  voiceId: z.string().optional(),
  language: z.string().optional(),
});

server.registerTool(
  'list_tenants',
  {
    title: 'List tenants',
    description: 'List calldesktech tenants. A tenant is the account/billing wrapper — see list_agents for what it actually runs.',
    inputSchema: {},
  },
  async () => {
    const { data, error } = await supabase
      .from('calldesk_tenants')
      .select('id, name, created_at')
      .order('created_at', { ascending: false });
    if (error) return errorResult(error.message);
    return jsonResult({ tenants: data || [] });
  }
);

server.registerTool(
  'list_agents',
  {
    title: 'List a tenant\'s agents',
    description:
      'List the agents belonging to a tenant. An agent is a named line of versions (e.g. "Front Desk") — ' +
      '`mode` is "simple" while the wizard still owns it, or "advanced" once graduated to the console (one-way).',
    inputSchema: { tenantId: z.string() },
  },
  async ({ tenantId }) => {
    const { data, error } = await supabase
      .from('calldesk_agents')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (error) return errorResult(error.message);
    return jsonResult({ agents: data || [] });
  }
);

server.registerTool(
  'create_agent',
  {
    title: 'Create an agent',
    description: 'Create a new agent for a tenant, in "simple" mode. Has no versions yet — call create_agent_version next.',
    inputSchema: { tenantId: z.string(), name: z.string() },
  },
  async ({ tenantId, name }) => {
    const { data, error } = await supabase
      .from('calldesk_agents')
      .insert({ tenant_id: tenantId, name, mode: 'simple' })
      .select()
      .single();
    if (error) return errorResult(error.message);
    return jsonResult({ agent: data });
  }
);

server.registerTool(
  'graduate_agent',
  {
    title: 'Graduate an agent to advanced mode',
    description:
      'Permanently switches an agent from "simple" (wizard-owned) to "advanced" (console-owned) — one-way, ' +
      'per the product decision that a hand-edited flow never gets reverse-parsed back into wizard fields. ' +
      'Confirm with the caller before invoking this; there is no undo tool.',
    inputSchema: { agentId: z.string() },
  },
  async ({ agentId }) => {
    const { data, error } = await supabase
      .from('calldesk_agents')
      .update({ mode: 'advanced' })
      .eq('id', agentId)
      .select()
      .single();
    if (error) return errorResult(error.message);
    return jsonResult({ agent: data });
  }
);

server.registerTool(
  'list_agent_versions',
  {
    title: 'List an agent\'s versions',
    description: 'List all versions of an agent, newest first, including each version\'s flow_id and voice_engine.',
    inputSchema: { agentId: z.string() },
  },
  async ({ agentId }) => {
    const { data, error } = await supabase
      .from('calldesk_agent_versions')
      .select('*')
      .eq('agent_id', agentId)
      .order('version_number', { ascending: false });
    if (error) return errorResult(error.message);
    return jsonResult({ versions: data || [] });
  }
);

server.registerTool(
  'create_agent_version',
  {
    title: 'Create a new agent version',
    description:
      'Creates a new, immutable version of an agent — this is what both the wizard and the console do on every ' +
      'edit, never mutating a version in place. Always requires the full flow (nodes + startNodeId), since a ' +
      'version pins to one flow snapshot. Node types: greeting, extraction (collects fields via `extract`), ' +
      'function (calls params.webhookUrl once on entry), knowledge_base, transfer (redirects a live Twilio call ' +
      'to params.transferTo), goodbye (hangs up once its message finishes). Edges are evaluated by the LLM via ' +
      'real tool-calling at runtime, not string-matched. Does NOT route any phone number to this version — call ' +
      'route_phone_number for that once you\'re ready to make it live.',
    inputSchema: {
      agentId: z.string(),
      flowName: z.string(),
      startNodeId: z.string().describe('id of the node the flow begins at'),
      nodes: z.array(flowNodeSchema),
      globalSettings: globalSettingsSchema.optional(),
      voiceEngine: z.enum(['retell', 'poc']).default('retell'),
      retellAgentId: z.string().optional(),
      retellLlmId: z.string().optional(),
      voiceId: z.string().optional(),
      ttsBackend: z.enum(['kokoro', 'elevenlabs']).optional(),
      wizardConfig: z.record(z.any()).optional().describe('The wizard\'s own answers that produced this version, if any — omit for advanced-mode edits.'),
    },
  },
  async ({ agentId, flowName, startNodeId, nodes, globalSettings, voiceEngine, retellAgentId, retellLlmId, voiceId, ttsBackend, wizardConfig }) => {
    if (!nodes.some((n) => n.id === startNodeId)) {
      return errorResult(`startNodeId "${startNodeId}" is not one of the provided nodes' ids`);
    }
    for (const node of nodes) {
      for (const edge of node.edges) {
        if (!nodes.some((n) => n.id === edge.target)) {
          return errorResult(`node "${node.id}" has an edge targeting unknown node "${edge.target}"`);
        }
      }
    }

    const { data: agent, error: agentError } = await supabase
      .from('calldesk_agents')
      .select('tenant_id')
      .eq('id', agentId)
      .single();
    if (agentError || !agent) return errorResult(agentError?.message || 'agent not found');

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
    if (flowError) return errorResult(flowError.message);

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
        voice_engine: voiceEngine,
        flow_id: flow.id,
        retell_agent_id: retellAgentId,
        retell_llm_id: retellLlmId,
        voice_id: voiceId,
        tts_backend: ttsBackend,
        wizard_config: wizardConfig,
      })
      .select()
      .single();
    if (versionError) return errorResult(versionError.message);

    return jsonResult({ version, flow });
  }
);

server.registerTool(
  'list_phone_numbers',
  {
    title: 'List a tenant\'s phone numbers',
    description: 'List a tenant\'s phone numbers and which agent version each is routed to, per direction.',
    inputSchema: { tenantId: z.string() },
  },
  async ({ tenantId }) => {
    const { data, error } = await supabase
      .from('calldesk_phone_numbers')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (error) return errorResult(error.message);
    return jsonResult({ phoneNumbers: data || [] });
  }
);

server.registerTool(
  'create_phone_number',
  {
    title: 'Register a phone number',
    description: 'Registers a phone number on a tenant, with no routing yet — call route_phone_number next to make it do anything.',
    inputSchema: { tenantId: z.string(), number: z.string().describe('E.164 format, e.g. +14155551234') },
  },
  async ({ tenantId, number }) => {
    const { data, error } = await supabase
      .from('calldesk_phone_numbers')
      .insert({ tenant_id: tenantId, number })
      .select()
      .single();
    if (error) return errorResult(error.message);
    return jsonResult({ phoneNumber: data });
  }
);

server.registerTool(
  'route_phone_number',
  {
    title: 'Route a phone number to an agent version',
    description:
      'Points a phone number\'s inbound or outbound slot at a specific agent version — this IS "activation" in ' +
      'this model (mirrors Retell\'s own Inbound/Outbound Call Agent dropdowns). Rolling back is just calling ' +
      'this again with an older version\'s id. For a retell-engine version\'s inbound slot, also pushes the ' +
      'flow to Retell as a flattened prompt via calldesktech\'s sync route (no-op for poc engine, which reads ' +
      'the flow directly at call time).',
    inputSchema: {
      phoneNumberId: z.string(),
      direction: z.enum(['inbound', 'outbound']),
      agentVersionId: z.string().nullable().describe('null to disable this direction (e.g. turn outbound off)'),
    },
  },
  async ({ phoneNumberId, direction, agentVersionId }) => {
    const column = direction === 'inbound' ? 'inbound_agent_version_id' : 'outbound_agent_version_id';
    const { data: phoneNumber, error } = await supabase
      .from('calldesk_phone_numbers')
      .update({ [column]: agentVersionId })
      .eq('id', phoneNumberId)
      .select()
      .single();
    if (error) return errorResult(error.message);

    if (direction !== 'inbound' || !agentVersionId) {
      return jsonResult({ phoneNumber, syncedToRetell: false });
    }

    const { data: version } = await supabase
      .from('calldesk_agent_versions')
      .select('voice_engine')
      .eq('id', agentVersionId)
      .single();
    if (version?.voice_engine !== 'retell') {
      return jsonResult({ phoneNumber, syncedToRetell: false });
    }

    try {
      const res = await fetch(`${CALLDESKTECH_BASE_URL}/api/agent-versions/${agentVersionId}/sync-retell`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return errorResult(body.error || `sync route returned HTTP ${res.status}`);
      return jsonResult({ phoneNumber, syncedToRetell: true });
    } catch (err) {
      return errorResult(`could not reach calldesktech at ${CALLDESKTECH_BASE_URL} — is it running? (${err.message})`);
    }
  }
);

// --- Headless test-call harness -------------------------------------------
// A "test call" is a real WS session against call-loop-poc's actual flow
// engine, driven by typed text instead of a phone/microphone (see
// CallSession's `user_text` debug message type in call-loop-poc/server.js).
// Sessions are kept in memory here for the lifetime of this MCP server
// process — they don't survive a restart, which is fine for interactive
// testing but means a long-idle session should be ended explicitly.
const testSessions = new Map();

function jsonResult(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}
function errorResult(message) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }], isError: true };
}

async function fetchFlowForVersion(agentVersionId) {
  const { data: version, error: versionError } = await supabase
    .from('calldesk_agent_versions')
    .select('flow_id, tts_backend, voice_id')
    .eq('id', agentVersionId)
    .single();
  if (versionError || !version) throw new Error(`agent version ${agentVersionId} not found`);
  if (!version.flow_id) throw new Error(`agent version ${agentVersionId} has no flow`);

  const { data: flow, error: flowError } = await supabase
    .from('calldesk_conversation_flows')
    .select('*')
    .eq('id', version.flow_id)
    .single();
  if (flowError || !flow) throw new Error(`flow ${version.flow_id} not found`);

  return {
    startNodeId: flow.global_settings?.startNodeId || flow.nodes[0]?.id,
    nodes: flow.nodes,
    globalSettings: flow.global_settings,
    ttsBackend: version.tts_backend || undefined,
  };
}

// One caller utterance can trigger a *cascade* of events, not just one —
// a transition's flow_state fires only once that turn's TTS finishes
// (slightly after its assistant_turn text), and an auto-advance node
// (function/knowledge_base/goodbye/transfer) then generates its OWN
// assistant_turn right after that, all still "the result of" the single
// user_text message that started it. Resolving on the first event (the
// original implementation) reported stale node/collectedData and dropped
// auto-advanced dialogue entirely. Instead, collect events until the
// socket closes (flow hung up / transferred) or QUIET_MS passes with
// nothing new — whichever comes first, capped by the hard timeout.
// Needs to comfortably cover a *chained* auto-advance turn — e.g.
// transitioning into 'goodbye' fires flow_state, then goodbye's own LLM call
// (a fresh ~700-1100ms TTFB plus full generation) produces its own
// assistant_turn. 2.5s measured too tight in testing and silently dropped
// that second turn's text when the caller then ended the session right
// after the transition; 6s leaves real margin at the cost of that much
// added latency per test turn when nothing more is coming.
const QUIET_MS = 6000;

function waitForTurn(session) {
  return new Promise((resolve) => {
    const texts = [];
    let lastNodeId = session.lastNodeId;
    let lastCollectedData = session.lastCollectedData ?? {};
    let sawError = null;
    let quietTimer = null;
    const hardTimer = setTimeout(() => finish(false), TEST_TURN_TIMEOUT_MS);

    function bumpQuietTimer() {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish(false), QUIET_MS);
    }

    function onMessage(data, isBinary) {
      // Binary frames are synthesized TTS audio — the harness doesn't care
      // about the audio itself, but it IS proof the call is still doing
      // something (e.g. speaking a fallback line before a goodbye/transfer
      // actually fires), so it still has to keep the quiet window alive.
      // Without this, the window could expire — and the caller call
      // end_test_call — while speech is still in flight, right before the
      // real hangup/transfer this test was trying to observe.
      if (isBinary) {
        bumpQuietTimer();
        return;
      }
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === 'assistant_turn') {
        if (msg.text) texts.push(msg.text);
        lastNodeId = msg.nodeId ?? lastNodeId;
        bumpQuietTimer();
      } else if (msg.type === 'flow_state') {
        lastNodeId = msg.currentNodeId;
        lastCollectedData = msg.collectedData;
        bumpQuietTimer();
      } else if (msg.type === 'tts_event') {
        bumpQuietTimer(); // chunk_meta/done — kokoro-path speech progress, same reasoning as binary frames above
      } else if (msg.type === 'error') {
        sawError = msg.message;
        finish(false);
      }
    }
    function onClose() {
      finish(true);
    }
    function finish(closed) {
      clearTimeout(hardTimer);
      if (quietTimer) clearTimeout(quietTimer);
      session.ws.off('message', onMessage);
      session.ws.off('close', onClose);
      session.lastNodeId = lastNodeId;
      session.lastCollectedData = lastCollectedData;
      resolve({
        text: texts.join(' ') || null,
        nodeId: lastNodeId,
        collectedData: lastCollectedData,
        callEnded: closed,
        error: sawError,
        timedOut: texts.length === 0 && !sawError && !closed,
      });
    }
    session.ws.on('message', onMessage);
    session.ws.on('close', onClose);
  });
}

server.registerTool(
  'start_test_call',
  {
    title: 'Start a headless flow test call',
    description:
      'Opens a real session against call-loop-poc using a specific agent version\'s flow (works regardless of ' +
      'that version\'s voice_engine, and independent of whether any phone number is actually routed to it — ' +
      'this tests the flow itself, not the live routing), and returns the opening line and starting node. Drive ' +
      'it with send_test_turn, and close it with end_test_call when done — sessions are NOT cleaned up ' +
      'automatically. Requires call-loop-poc running locally (default ws://localhost:8090/call).',
    inputSchema: { agentVersionId: z.string() },
  },
  async ({ agentVersionId }) => {
    let flow;
    try {
      flow = await fetchFlowForVersion(agentVersionId);
    } catch (err) {
      return errorResult(err.message);
    }

    const testSessionId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ws = new WebSocket(CALL_LOOP_WS_URL);
    const session = { ws, agentVersionId, lastNodeId: flow.startNodeId, lastCollectedData: {} };

    try {
      await new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });
    } catch (err) {
      return errorResult(`could not reach call-loop-poc at ${CALL_LOOP_WS_URL} — is it running? (${err.message})`);
    }

    testSessions.set(testSessionId, session);
    const turnPromise = waitForTurn(session);
    ws.send(JSON.stringify({
      type: 'context',
      flow,
      ...(flow.ttsBackend ? { ttsBackend: flow.ttsBackend } : {}),
    }));
    const result = await turnPromise;

    return jsonResult({ testSessionId, opening: result.text, currentNodeId: result.nodeId, collectedData: result.collectedData });
  }
);

server.registerTool(
  'send_test_turn',
  {
    title: 'Send a caller turn in a test call',
    description:
      'Sends a typed caller utterance into an open test call (as if Deepgram had just transcribed it) and returns ' +
      'the assistant\'s reply, the flow\'s current node, and any data collected so far. If callEnded is true, the ' +
      'flow hung up or transferred and this session is no longer usable.',
    inputSchema: { testSessionId: z.string(), text: z.string() },
  },
  async ({ testSessionId, text }) => {
    const session = testSessions.get(testSessionId);
    if (!session) return errorResult(`no test session "${testSessionId}" — did it already end?`);
    if (session.ws.readyState !== WebSocket.OPEN) {
      testSessions.delete(testSessionId);
      return errorResult('test call already closed (flow likely hung up or transferred)');
    }
    const turnPromise = waitForTurn(session);
    session.ws.send(JSON.stringify({ type: 'user_text', text }));
    const result = await turnPromise;
    if (result.callEnded) testSessions.delete(testSessionId);
    return jsonResult({
      reply: result.text,
      currentNodeId: result.nodeId,
      collectedData: result.collectedData,
      callEnded: result.callEnded,
      timedOut: result.timedOut,
      error: result.error,
    });
  }
);

server.registerTool(
  'end_test_call',
  {
    title: 'End a test call',
    description: 'Closes an open test call session.',
    inputSchema: { testSessionId: z.string() },
  },
  async ({ testSessionId }) => {
    const session = testSessions.get(testSessionId);
    if (!session) return jsonResult({ alreadyEnded: true });
    try {
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({ type: 'hangup' }));
      }
      session.ws.close();
    } catch {
      // already closed
    }
    testSessions.delete(testSessionId);
    return jsonResult({ ended: true });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[flow-mcp] running (stdio)');
