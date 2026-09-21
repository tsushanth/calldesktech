// @ts-nocheck
// Tool registrations for the hosted MCP endpoint (/mcp). Mirrors the npm
// package's tools (calldesktech-mcp); `api` and `tenant` are bound per request.
import { z } from 'zod';

export function registerTools(server, api, tenant) {
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (err) => ({ isError: true, content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }] });
const run = (fn) => async (args) => { try { return ok(await fn(args)); } catch (e) { return fail(e); } };

const READ = { readOnlyHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false };
const DESTROY = { readOnlyHint: false, destructiveHint: true };
const COSTS = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

const GUIDE = `# Authoring a CallDeskTech conversation flow

A flow is { startNodeId, nodes[] }. Each node: { id, type, prompt?, extract?, function?, params?, edges[] }.
An edge is { id, condition, target } where target is another node's id in the SAME flow.
The model only ever sees the CURRENT node's prompt plus its edges as a transition tool, so
write each node as one focused step and put branching in edge conditions (plain-English, judged by the model).

## Node types
Conversational (speak, wait for the caller, then take an edge):
- greeting     — say something; params.interruptionSensitivity optional
- extraction   — collect fields: extract = { field_name: "string" }; leave via an edge when the fields are collected
Auto-advancing (act immediately on entry, no caller turn needed; the prompt is what to SAY about it):
- function       — webhook: function = "name", params.webhookUrl (POSTs { function, collectedData }); result is folded into context
- knowledge_base — answers from the agent's attached knowledge base (create the KB with agent_id set!)
- sms            — params { body, to? } (to defaults to the caller); supports {{field}}
- code           — params.code: JavaScript sandbox, "dv" holds collected data, return an object to merge into it
- mcp            — params { serverUrl, toolName, toolArguments (JSON string), headers (JSON string, e.g. Authorization) }
- payment        — params { amount, paymentConnector, description }; sets payment_status = succeeded | failed
- transfer       — params.transferTo (E.164); ends the AI's involvement; optional params.spokenMessage (said word for word)
- agent_transfer — params.targetAgentId (another agent in the workspace); hands the live call to that agent's latest published version; optional params.spokenMessage; no outgoing edges
- press_digit    — params.digits (0-9 * # A-D w=pause, {{field}} ok); EXACTLY ONE edge; plays DTMF tones
- logic_split    — no prompt; edges use structured conditions { field, operator (== != > < >= <=), value }; a conditionless edge is the default
- subflow_ref    — params.subflowId; runs a reusable sub-graph (create it with create_subflow) then leaves via THIS node's edges
- subagent       — params.tools = JSON array of { id, kind: function|code|sms|mcp|transfer, description, ... }; the model picks tools freely
- goodbye        — say goodbye and hang up (0 edges)

IMPORTANT: extraction/greeting nodes WAIT for the caller after being entered. If a step must speak
immediately after a transition, use an auto-advancing type (function/goodbye/...) or fold the words into the previous node.

## Global settings (publish_agent_version.globalSettings)
allowInterruptions (false = never interrupt), interruptionSensitivity (high|medium|low|off; a node's params.interruptionSensitivity overrides),
language (en default | es | fr | pt-BR | it | nl | hi | de | pl | id | ar: sets speech recognition, reply language and voice; non-English poc agents are pinned to the ElevenLabs voice, billed at the ElevenLabs rate), transcriptionMode (fast|balanced|accurate), transitionFlexibility (strict|flexible), handbook (agent-wide reference text), timezone,
variables (Record<string,string>: values for {{name}} placeholders in prompts, spoken lines and the voicemail message; only non-empty values are substituted, unknown placeholders are left as-is).
Built-in templates use {{business_name}} and {{agent_name}}; set them via create_agent_from_template's variables argument (list_agent_templates shows each template's defaultVariables and placeholders). agent_name works even on templates whose own prompt never mentions {{agent_name}} directly — every template gets an identity clause appended automatically (use the name if set, otherwise the agent picks and sticks with one on its own).

## Workflow
1) create_agent  2) (optional) create_knowledge_base with agent_id + add_knowledge_items, create_subflow
3) publish_agent_version (versions are immutable)  4) set_number_routing to point a number at the new version's id,
   or to an environment (staging/production) so later promotions take effect with no further routing call
5) place_call to test.

## Environments (staging/production)
Every agent has both from creation. A number/batch call can route to an environment instead of a raw version
(set_number_routing's environmentId) — whatever version that environment currently points to is what runs.
promote_agent_environment repoints an environment at a version; every number already routed to it picks the change
up immediately. Rolling back is just promoting an older version again.`;

server.registerTool('flow_authoring_guide', { description: 'Read this FIRST before publishing a flow: node types, params, edge rules, gotchas.', annotations: READ, inputSchema: {} }, async () => ({ content: [{ type: 'text', text: GUIDE }] }));
server.registerTool('whoami', { description: 'Show the workspace this API key is pinned to.', annotations: READ, inputSchema: {} }, run(() => api('GET', '/me')));

// ---- agents
server.registerTool('list_agents', { description: 'List agents with their latest version’s engine/voice and routed phone numbers.', annotations: READ, inputSchema: {} }, run(async () => api('GET', `/tenants/${await tenant()}/agents`)));
server.registerTool('create_agent', { description: 'Create an agent (no flow yet — publish a version next).', annotations: WRITE, inputSchema: { name: z.string().min(1), mode: z.enum(['simple', 'advanced']).optional() } }, run(async (a) => api('POST', `/tenants/${await tenant()}/agents`, a)));
server.registerTool('get_agent', { description: 'Get one agent.', annotations: READ, inputSchema: { agentId: z.string() } }, run((a) => api('GET', `/agents/${a.agentId}`)));
server.registerTool('rename_agent', { description: 'Rename an agent.', annotations: WRITE, inputSchema: { agentId: z.string(), name: z.string().min(1) } }, run((a) => api('PATCH', `/agents/${a.agentId}`, { name: a.name })));
server.registerTool('delete_agent', { description: 'PERMANENTLY delete an agent and its versions, subflows and knowledge bases.', annotations: DESTROY, inputSchema: { agentId: z.string() } }, run((a) => api('DELETE', `/agents/${a.agentId}`)));
server.registerTool('list_agent_versions', { description: 'List an agent’s immutable versions, newest first.', annotations: READ, inputSchema: { agentId: z.string() } }, run((a) => api('GET', `/agents/${a.agentId}/versions`)));
server.registerTool('publish_agent_version', {
  description: 'Publish a new immutable version of an agent from a conversation-flow graph. Call flow_authoring_guide first. Returns the version id to route a number to.',
  annotations: WRITE,
  inputSchema: {
    agentId: z.string(),
    flowName: z.string(),
    startNodeId: z.string(),
    nodes: z.array(z.record(z.any())).min(1).describe('FlowNode[] — see flow_authoring_guide'),
    voiceEngine: z.enum(['poc', 'retell']).default('poc'),
    globalSettings: z.record(z.any()).optional(),
    voiceId: z.string().optional(),
    ttsBackend: z.enum(['kokoro', 'elevenlabs', 'cartesia', 'minimax']).optional(),
  },
}, run(({ agentId, ...body }) => api('POST', `/agents/${agentId}/versions`, body)));

// ---- subflows
server.registerTool('list_subflows', { description: 'List subflows (library ones plus the given agent’s own).', annotations: READ, inputSchema: { agentId: z.string().optional() } }, run(async (a) => api('GET', `/tenants/${await tenant()}/subflows${a.agentId ? `?agentId=${a.agentId}` : ''}`)));
server.registerTool('create_subflow', { description: 'Create a reusable sub-graph. Reference it from a subflow_ref node (params.subflowId). Its zero-edge nodes are exits back to the ref node’s edges.', annotations: WRITE, inputSchema: { name: z.string(), scope: z.enum(['agent', 'library']).default('agent'), agentId: z.string().optional(), nodes: z.array(z.record(z.any())), startNodeId: z.string() } }, run(async (a) => api('POST', `/tenants/${await tenant()}/subflows`, a)));
server.registerTool('update_subflow', { description: 'Update a subflow. Already-published versions keep their snapshot.', annotations: WRITE, inputSchema: { subflowId: z.string(), name: z.string().optional(), nodes: z.array(z.record(z.any())).optional(), startNodeId: z.string().optional() } }, run(async ({ subflowId, ...b }) => api('PATCH', `/tenants/${await tenant()}/subflows/${subflowId}`, b)));
server.registerTool('delete_subflow', { description: 'Delete a subflow.', annotations: DESTROY, inputSchema: { subflowId: z.string() } }, run(async (a) => api('DELETE', `/tenants/${await tenant()}/subflows/${a.subflowId}`)));

// ---- knowledge bases
server.registerTool('list_knowledge_bases', { description: 'List knowledge bases.', annotations: READ, inputSchema: {} }, run(async () => api('GET', `/tenants/${await tenant()}/knowledge-bases`)));
server.registerTool('create_knowledge_base', { description: 'Create a knowledge base. Set agent_id, or a knowledge_base node will not see its content. Use source_type "manual" then add_knowledge_items, or "website" with source_url.', annotations: WRITE, inputSchema: { name: z.string(), source_type: z.enum(['manual', 'website', 'pdf']), source_url: z.string().optional(), agent_id: z.string().optional() } }, run(async (a) => api('POST', `/tenants/${await tenant()}/knowledge-bases`, a)));
server.registerTool('add_knowledge_items', { description: 'Add Q&A items to a knowledge base.', annotations: WRITE, inputSchema: { knowledgeBaseId: z.string(), items: z.array(z.object({ question: z.string(), answer: z.string() })).min(1) } }, run((a) => api('POST', `/knowledge-bases/${a.knowledgeBaseId}/items`, { items: a.items })));
server.registerTool('delete_knowledge_base', { description: 'Delete a knowledge base and its items.', annotations: DESTROY, inputSchema: { knowledgeBaseId: z.string() } }, run((a) => api('DELETE', `/knowledge-bases/${a.knowledgeBaseId}`)));

// ---- numbers & calls
server.registerTool('list_phone_numbers', { description: 'List phone numbers and which agent versions they route to.', annotations: READ, inputSchema: {} }, run(async () => api('GET', `/tenants/${await tenant()}/phone-numbers`)));
server.registerTool('set_number_routing', { description: 'Route a number’s inbound or outbound calls to a specific agent version, OR to an environment (see list_agent_environments/promote_agent_environment) — pass exactly one of agentVersionId or environmentId. Environment routing means promoting a new version later takes effect on this number automatically. Pass agentVersionId: null to disable a direction.', annotations: WRITE, inputSchema: { phoneNumberId: z.string(), direction: z.enum(['inbound', 'outbound']), agentVersionId: z.string().nullable().optional(), environmentId: z.string().optional() } }, run((a) => api('POST', `/phone-numbers/${a.phoneNumberId}/routing`, { direction: a.direction, agentVersionId: a.agentVersionId, environmentId: a.environmentId })));
server.registerTool('list_agent_environments', { description: 'List an agent’s staging/production environments and which version each currently points to (null if nothing promoted yet).', annotations: READ, inputSchema: { agentId: z.string() } }, run((a) => api('GET', `/agents/${a.agentId}/environments`)));
server.registerTool('promote_agent_environment', { description: 'Promote a version into staging or production. Every number/batch call routed to that environment picks up the new version immediately — no re-routing needed. Rolling back is promoting an older version again.', annotations: WRITE, inputSchema: { agentId: z.string(), name: z.enum(['staging', 'production']), versionId: z.string() } }, run((a) => api('POST', `/agents/${a.agentId}/environments/${a.name}/promote`, { versionId: a.versionId })));
server.registerTool('place_call', { description: 'Place a REAL outbound phone call (costs money) from one of your numbers using its outbound agent.', annotations: COSTS, inputSchema: { phoneNumberId: z.string(), toNumber: z.string().describe('E.164, e.g. +14155550123') } }, run((a) => api('POST', `/phone-numbers/${a.phoneNumberId}/call`, { toNumber: a.toNumber })));
server.registerTool('list_calls', { description: 'List recent calls.', annotations: READ, inputSchema: { limit: z.number().int().min(1).max(200).optional() } }, run(async (a) => api('GET', `/tenants/${await tenant()}/calls?limit=${a.limit ?? 25}`)));
server.registerTool('list_agent_templates', { description: 'List the built-in agent templates (receptionist, medical receptionist, payment collection, IVR navigation, etc.) that can be installed with create_agent_from_template.', annotations: READ, inputSchema: {} }, run(() => api('GET', '/agent-templates')));
server.registerTool('create_agent_from_template', { description: 'Create a ready-to-call agent from a built-in template and publish its first version. voiceEngine "poc" runs on CallDesk; "retell" also creates the equivalent Retell agent (some node types are approximated; see warnings). transferTo (E.164) fills empty transfer numbers; functionUrl fills empty function webhooks. variables sets the template\'s {{placeholders}}, e.g. {"business_name": "Acme Dental", "agent_name": "Sam"} (business_name defaults to the account name; see list_agent_templates for each template\'s defaultVariables and placeholders).', annotations: WRITE, inputSchema: { templateId: z.string(), name: z.string().optional(), voiceEngine: z.enum(['poc', 'retell']).default('poc'), transferTo: z.string().optional(), functionUrl: z.string().url().optional(), variables: z.record(z.string()).optional(), language: z.enum(['en', 'es', 'fr', 'pt-BR', 'it', 'nl', 'hi', 'de', 'pl', 'id', 'ar']).optional().describe('Agent language (default en); non-English uses the ElevenLabs voice') } }, run(async (a) => api('POST', `/tenants/${await tenant()}/agents/from-template`, a)));
server.registerTool('get_call', { description: 'Get one call: transcript, outcome, duration, transfer status.', annotations: READ, inputSchema: { callId: z.string() } }, run((a) => api('GET', `/calls/${a.callId}`)));
server.registerTool('analyze_agent_copilot', { description: 'Analyze an agent\'s recent real calls (transcripts + QA critiques) for recurring problems and propose concrete flow node-edit suggestions, each grounded in specific call transcripts. Requires at least 5 usable calls. Never edits the flow — suggestions are stored pending; accept/dismiss them from the dashboard.', annotations: WRITE, inputSchema: { agentId: z.string() } }, run((a) => api('POST', `/agents/${a.agentId}/copilot/analyze`)));

// ---- batch calls
server.registerTool('list_batch_calls', { description: 'List batch calls.', annotations: READ, inputSchema: {} }, run(async () => api('GET', `/tenants/${await tenant()}/batch-calls`)));
server.registerTool('create_batch_call', { description: 'Create (not start) a batch of outbound calls for an agent version. phoneNumbers can be plain E.164 numbers, or CSV rows "phone,first_name,..." (with a header row) to personalize each call — extra columns become {{variables}} the agent can use. Optionally name the batch, scheduledAt an ISO time to run it automatically instead of via run_batch_call, and/or restrict callTimeWindow.', annotations: WRITE, inputSchema: { agentVersionId: z.string(), phoneNumbers: z.array(z.string()).min(1).describe('E.164 numbers, or CSV rows including a header row with a phone column plus optional variable columns'), name: z.string().optional(), scheduledAt: z.string().optional().describe('ISO datetime to run automatically instead of via run_batch_call'), callTimeWindow: z.object({ timezone: z.string(), days: z.array(z.number().int().min(0).max(6)), start_hour: z.number().int().min(0).max(23), end_hour: z.number().int().min(1).max(24) }).optional() } }, run(async (a) => api('POST', `/tenants/${await tenant()}/batch-calls`, a)));
server.registerTool('get_batch_call', { description: 'Get a batch and every target: phone number, dial status, dynamic_variables used, and call_log_id once placed.', annotations: READ, inputSchema: { batchId: z.string() } }, run((a) => api('GET', `/batch-calls/${a.batchId}`)));
server.registerTool('run_batch_call', { description: 'START a batch — dials every number (costs money; paced by rate limits). Fails with a 409-style error if the batch is scheduled for later and not yet due, or outside its callTimeWindow.', annotations: COSTS, inputSchema: { batchId: z.string() } }, run((a) => api('POST', `/batch-calls/${a.batchId}/run`)));

// ---- webhooks
server.registerTool('list_webhooks', { description: 'List webhooks.', annotations: READ, inputSchema: {} }, run(async () => api('GET', `/tenants/${await tenant()}/webhooks`)));
server.registerTool('create_webhook', { description: 'Register a webhook. Events: call.started, call.completed, call.analyzed, call.transferred. Returns the signing secret.', annotations: WRITE, inputSchema: { url: z.string().url(), events: z.array(z.enum(['call.started', 'call.completed', 'call.analyzed', 'call.transferred'])).optional() } }, run(async (a) => api('POST', `/tenants/${await tenant()}/webhooks`, a)));
server.registerTool('delete_webhook', { description: 'Delete a webhook.', annotations: DESTROY, inputSchema: { webhookId: z.string() } }, run(async (a) => api('DELETE', `/tenants/${await tenant()}/webhooks/${a.webhookId}`)));

// ---- analytics
server.registerTool('get_analytics', { description: 'Call analytics by day.', annotations: READ, inputSchema: { days: z.enum(['7', '30', '90']).default('30') } }, run(async (a) => api('GET', `/tenants/${await tenant()}/analytics?days=${a.days}`)));
server.registerTool('get_qa_overview', { description: 'QA scores, resolution rate and transfer metrics.', annotations: READ, inputSchema: { days: z.enum(['7', '30', '90']).default('30') } }, run(async (a) => api('GET', `/tenants/${await tenant()}/qa/overview?days=${a.days}`)));



}
