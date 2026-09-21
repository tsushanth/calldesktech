// Hand-maintained OpenAPI 3.1 description of the public API (/api/v1/*).
// Deliberately covers the supported surface, not all ~70 internal routes
// (mobile, admin, billing checkout and the like are not public API).
// Served at /api/v1/openapi.json and rendered at /docs.

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
interface Op {
  tag: string;
  summary: string;
  description?: string;
  query?: Record<string, string>;
  body?: Record<string, string>;
  bodyRequired?: string[];
  returns?: string;
}

const T = '{tenantId}';
const ops: Record<string, Partial<Record<Method, Op>>> = {
  '/me': { get: { tag: 'Account', summary: 'Who am I?', description: 'For an API key, returns the tenant it is pinned to — use that id in the paths below.', returns: '{ auth, tenantId, tenantName }' } },

  [`/tenants/${T}/agents`]: {
    get: { tag: 'Agents', summary: 'List agents', description: 'Each agent includes its latest version’s engine/voice and any routed phone numbers.', returns: '{ agents: Agent[] }' },
    post: { tag: 'Agents', summary: 'Create an agent', body: { name: 'string', mode: "'simple' | 'advanced'" }, bodyRequired: ['name'], returns: '{ agent }' },
  },
  '/agents/{agentId}': {
    get: { tag: 'Agents', summary: 'Get an agent', returns: '{ agent }' },
    patch: { tag: 'Agents', summary: 'Rename an agent', body: { name: 'string' }, returns: '{ agent }' },
    delete: { tag: 'Agents', summary: 'Delete an agent', description: 'Also deletes its versions, subflows and knowledge bases.', returns: '{ success }' },
  },
  '/agents/{agentId}/versions': {
    get: { tag: 'Agents', summary: 'List versions', returns: '{ versions: AgentVersion[] }' },
    post: {
      tag: 'Agents', summary: 'Publish a new version',
      description: 'Versions are immutable. Set `globalSettings.language` (en default; es, fr, pt-BR, it, nl, hi, de, pl, id, ar) for a non-English agent: the engine switches speech recognition, the reply language and the voice, and a non-English poc agent is pinned to the ElevenLabs voice (billed at the ElevenLabs rate). `nodes` is the conversation-flow graph; `subflow_ref` nodes are embedded as snapshots at publish time.',
      body: { flowName: 'string', startNodeId: 'string', nodes: 'FlowNode[]', globalSettings: 'object', voiceEngine: "'poc' | 'retell'", voiceId: 'string', ttsBackend: "'kokoro' | 'elevenlabs' | 'cartesia' | 'minimax'" },
      bodyRequired: ['flowName', 'startNodeId', 'nodes', 'voiceEngine'], returns: '{ version, flow }',
    },
  },
  '/agent-templates': { get: { tag: 'Agents', summary: 'List agent templates', description: 'Built-in templates (receptionist, medical receptionist, payment collection, IVR navigation and more) that can be installed as an agent.', returns: '{ templates: { id, label, description, category, defaultVariables: {name: value}, variables: string[] (the {{placeholders}} you can set on install) }[] }' } },
  [`/tenants/${T}/agents/from-template`]: {
    post: {
      tag: 'Agents', summary: 'Create an agent from a template',
      description: 'Creates the agent, its subflows and knowledge base, and publishes version 1. `voiceEngine` "poc" runs on CallDesk; "retell" also creates the equivalent Retell conversation-flow agent (some node types are approximated; see `warnings`). `transferTo` and `functionUrl` fill empty transfer numbers and function webhooks. `variables` sets the template\'s {{placeholders}} (see GET /agent-templates); business_name defaults to the tenant name.',
      body: { templateId: 'string (from GET /agent-templates)', name: 'string', voiceEngine: "'poc' | 'retell'", transferTo: 'E.164 string', functionUrl: 'https URL', calendarTools: 'false to turn off live calendar lookups and bookings', language: "agent language: 'en' (default), 'es', 'fr', 'pt-BR', 'it', 'nl', 'hi', 'de', 'pl', 'id' or 'ar'", variables: 'object, e.g. {"business_name": "Acme Dental", "agent_name": "Sam"}' },
      bodyRequired: ['templateId'], returns: '{ agentId, versionId, versionNumber, template, voiceEngine, retellAgentId?, warnings? }',
    },
  },
  [`/tenants/${T}/subflows`]: {
    get: { tag: 'Subflows', summary: 'List subflows', query: { agentId: 'Only library subflows plus this agent’s own' }, returns: '{ subflows: Subflow[] }' },
    post: { tag: 'Subflows', summary: 'Create a subflow', body: { name: 'string', scope: "'agent' | 'library'", agentId: 'string (agent scope)', nodes: 'FlowNode[]', startNodeId: 'string' }, bodyRequired: ['name'], returns: '{ subflow }' },
  },
  [`/tenants/${T}/subflows/{subflowId}`]: {
    get: { tag: 'Subflows', summary: 'Get a subflow', returns: '{ subflow }' },
    patch: { tag: 'Subflows', summary: 'Update a subflow', description: 'Already-published versions keep the snapshot they embedded.', body: { name: 'string', nodes: 'FlowNode[]', startNodeId: 'string', scope: 'string' }, returns: '{ subflow }' },
    delete: { tag: 'Subflows', summary: 'Delete a subflow', returns: '{ ok }' },
  },

  [`/tenants/${T}/knowledge-bases`]: {
    get: { tag: 'Knowledge bases', summary: 'List knowledge bases', returns: '{ knowledgeBases }' },
    post: { tag: 'Knowledge bases', summary: 'Create a knowledge base', description: 'Set `agent_id` — a knowledge_base node only sees content from a KB attached to its agent.', body: { name: 'string', source_type: "'website' | 'pdf' | 'manual'", source_url: 'string', agent_id: 'string' }, bodyRequired: ['name', 'source_type'], returns: '{ knowledgeBase }' },
  },
  '/knowledge-bases/{knowledgeBaseId}': {
    patch: { tag: 'Knowledge bases', summary: 'Rename or re-attach to an agent', body: { name: 'string', agent_id: 'string | null' }, returns: '{ knowledgeBase }' },
    delete: { tag: 'Knowledge bases', summary: 'Delete a knowledge base', returns: '{ success }' },
  },
  '/knowledge-bases/{knowledgeBaseId}/items': {
    get: { tag: 'Knowledge bases', summary: 'List Q&A items', returns: '{ items }' },
    post: { tag: 'Knowledge bases', summary: 'Add Q&A items', body: { items: '{ question: string, answer: string }[]' }, bodyRequired: ['items'], returns: '{ items }' },
  },

  '/agents/{agentId}/environments': {
    get: { tag: 'Agents', summary: 'List an agent\'s environments', description: 'Every agent has "staging" and "production", each pointing at the version it currently runs (null if nothing has been promoted into it yet).', returns: '{ environments: { id, name, version_id, updated_at }[] }' },
  },
  '/agents/{agentId}/environments/{name}/promote': {
    post: { tag: 'Agents', summary: 'Promote a version into staging or production', description: 'Every phone number (or batch call) routed to this environment picks up the new version immediately — no need to re-route. Rolling back is promoting an older version again.', body: { versionId: 'string' }, bodyRequired: ['versionId'], returns: '{ environment, resynced }' },
  },

  [`/tenants/${T}/phone-numbers`]: { get: { tag: 'Phone numbers', summary: 'List phone numbers', returns: '{ phoneNumbers }' } },
  '/phone-numbers/{phoneNumberId}/routing': {
    post: { tag: 'Phone numbers', summary: 'Route a number to an agent version or environment', description: 'Pass exactly one of agentVersionId (a specific version, direct pin) or environmentId (staging/production — the number always runs whatever version that environment currently points to, so promoting later needs no further call here).', body: { direction: "'inbound' | 'outbound'", agentVersionId: 'string | null', environmentId: 'string' }, bodyRequired: ['direction'], returns: '{ phoneNumber }' },
  },
  '/phone-numbers/{phoneNumberId}/call': {
    post: { tag: 'Calls', summary: 'Place an outbound call', description: 'Calls `toNumber` from this number using its outbound agent. Rate-limited per workspace (429).', body: { toNumber: 'E.164 string' }, bodyRequired: ['toNumber'], returns: '{ call: { sid, to } }' },
  },

  [`/tenants/${T}/calls`]: { get: { tag: 'Calls', summary: 'List calls', query: { limit: 'default 50' }, returns: '{ callLogs: CallLog[] }' } },
  '/calls/{callId}': { get: { tag: 'Calls', summary: 'Get a call', description: 'Includes transcript, outcome, duration, transfer status, and `analysis` (post-call analysis fields, null unless configured on the agent).', returns: '{ callLog }' } },
  '/calls/{callId}/recording': { get: { tag: 'Calls', summary: 'Stream a call recording', returns: 'audio' } },

  [`/tenants/${T}/batch-calls`]: {
    get: { tag: 'Batch calls', summary: 'List batch calls', returns: '{ batches }' },
    post: {
      tag: 'Batch calls',
      summary: 'Create a batch',
      description: 'phoneNumbers accepts either a plain list (newline/comma/semicolon-separated) or a CSV with a header row — a column named phone/phone_number/to/to_number/number is the recipient, every other column becomes a per-call dynamic variable (e.g. a "first_name" column lets the agent say {{first_name}}). Omit scheduledAt to leave the batch pending for a manual/API "run" call now; set it to a future ISO timestamp to have the platform run it automatically at that time instead.',
      body: {
        agentVersionId: 'string',
        phoneNumbers: 'string (plain list) or CSV text with a phone/phone_number/to/to_number/number column plus optional variable columns',
        name: 'string, optional label',
        scheduledAt: 'ISO datetime, optional — future time to run automatically instead of on manual/API trigger',
        callTimeWindow: 'optional { timezone: IANA string, days: number[] (0=Sun..6=Sat), start_hour: 0-23, end_hour: 1-24 } — restricts when this batch is allowed to dial',
      },
      bodyRequired: ['agentVersionId', 'phoneNumbers'],
      returns: '{ batch }',
    },
  },
  '/batch-calls/{batchId}': { get: { tag: 'Batch calls', summary: 'Get a batch and its targets', description: 'Each target includes its phone number, dial status, dynamic_variables used, and call_log_id once placed.', returns: '{ batchCall, targets }' } },
  '/batch-calls/{batchId}/run': { post: { tag: 'Batch calls', summary: 'Start a batch', description: 'Dials paced by the platform-wide and per-workspace rate limits. Returns 409 if the batch is scheduled for later and not yet due, or outside its callTimeWindow — retry after that time.', returns: '{ started, ... }' } },

  [`/tenants/${T}/webhooks`]: {
    get: { tag: 'Webhooks', summary: 'List webhooks', returns: '{ webhooks }' },
    post: { tag: 'Webhooks', summary: 'Register a webhook', description: 'Events: `call.started` (Retell-engine calls only), `call.completed` (includes `analysis` when configured), `call.transferred`, `call.analyzed` (post-call analysis results). Deliveries are signed with the returned `whsec_` secret (X-CallDesk-Event header names the event).', body: { url: 'https URL', events: "('call.started' | 'call.completed' | 'call.transferred' | 'call.analyzed')[]" }, bodyRequired: ['url'], returns: '{ webhook }' },
  },
  [`/tenants/${T}/webhooks/{webhookId}`]: {
    patch: { tag: 'Webhooks', summary: 'Update a webhook', body: { url: 'string', events: 'string[]', enabled: 'boolean' }, returns: '{ webhook }' },
    delete: { tag: 'Webhooks', summary: 'Delete a webhook', returns: '{ success }' },
  },
  [`/tenants/${T}/webhooks/{webhookId}/test`]: { post: { tag: 'Webhooks', summary: 'Send a test delivery', returns: '{ ok }' } },

  [`/tenants/${T}/contacts`]: { get: { tag: 'Contacts', summary: 'List contacts', returns: '{ contacts }' } },

  [`/tenants/${T}/crm`]: {
    get: { tag: 'CRM', summary: 'List CRM connections', description: 'Access/refresh tokens are never returned — write-only, like API keys.', returns: '{ connections: { id, provider, provider_account_id, expires_at, created_at }[] }' },
    delete: { tag: 'CRM', summary: 'Disconnect a CRM', query: { provider: "'hubspot' | 'salesforce'" }, returns: '{ success }' },
  },
  [`/tenants/${T}/crm/hubspot/connect`]: { get: { tag: 'CRM', summary: 'Start HubSpot OAuth connect', description: 'Browser-navigation endpoint (not JSON) — 302s to HubSpot\'s authorize screen. Owner/admin only.', returns: '302 redirect' } },
  [`/tenants/${T}/crm/hubspot/lookup`]: { get: { tag: 'CRM', summary: 'Look up a caller in HubSpot (CRM→us)', description: 'On-demand lookup by phone for call-time personalization, e.g. injecting {{crm_company_name}} as a dynamic variable. No background sync.', query: { phone: 'E.164 phone number' }, returns: '{ variables: { crm_contact_found, crm_first_name?, crm_last_name?, crm_company_name?, crm_email?, crm_job_title? } }' } },
  [`/tenants/${T}/analytics`]: { get: { tag: 'Analytics', summary: 'Call analytics by day', query: { days: '7 | 30 | 90' }, returns: '{ series, totals }' } },
  [`/tenants/${T}/qa/overview`]: { get: { tag: 'Quality', summary: 'QA scores, resolution and transfer metrics', query: { days: '7 | 30 | 90' }, returns: '{ avgScore, resolutionRate, transferSuccessRate, ... }' } },
  '/agents/{agentId}/test-cases': {
    get: { tag: 'Quality', summary: 'List simulation test cases', returns: '{ testCases }' },
    post: { tag: 'Quality', summary: 'Create a test case', body: { name: 'string', persona: 'string', successCriteria: 'string' }, returns: '{ testCase }' },
  },
  '/agents/{agentId}/test-cases/{testCaseId}/run': { post: { tag: 'Quality', summary: 'Run a simulation', returns: '{ passed, transcript, reasoning }' } },
  '/agents/{agentId}/copilot/analyze': {
    get: { tag: 'Quality', summary: 'List Copilot suggestions', returns: '{ suggestions }' },
    post: {
      tag: 'Quality', summary: 'Analyze recent calls for flow-edit suggestions',
      description: 'Looks at this agent\'s recent real calls (transcripts + QA critiques, whichever number is currently routed to it) for recurring problems and proposes concrete node-level prompt edits, each grounded in specific call transcripts. Requires at least 5 usable calls, otherwise returns a `not_enough_history` status instead of guessing. Never writes to the flow — suggestions are persisted as `pending` and must be accepted or dismissed via the suggestions route.',
      returns: '{ status, callCount, summary, suggestions: { id, node_id, current_text, suggested_text, rationale, supporting_call_ids, status }[] }',
    },
  },
};

function paramsFor(path: string) {
  return [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
    name: m[1], in: 'path', required: true, schema: { type: 'string' },
    description: m[1] === 'tenantId' ? 'Workspace id — from GET /me' : undefined,
  }));
}

export function buildOpenApi(serverUrl: string) {
  const paths: Record<string, unknown> = {};
  for (const [path, methods] of Object.entries(ops)) {
    const entry: Record<string, unknown> = {};
    for (const [method, op] of Object.entries(methods) as [Method, Op][]) {
      const parameters = [
        ...paramsFor(path),
        ...Object.entries(op.query || {}).map(([name, description]) => ({ name, in: 'query', required: false, description, schema: { type: 'string' } })),
      ];
      entry[method] = {
        tags: [op.tag],
        summary: op.summary,
        ...(op.description ? { description: op.description } : {}),
        ...(parameters.length ? { parameters } : {}),
        ...(op.body ? {
          requestBody: {
            required: !!op.bodyRequired?.length,
            content: { 'application/json': { schema: {
              type: 'object',
              properties: Object.fromEntries(Object.entries(op.body).map(([k, v]) => [k, { description: v }])),
              ...(op.bodyRequired?.length ? { required: op.bodyRequired } : {}),
            } } },
          },
        } : {}),
        responses: {
          '200': { description: op.returns ? `Returns ${op.returns}` : 'OK' },
          '401': { description: 'Missing or invalid credentials' },
          '404': { description: 'Not found, or not in your workspace' },
          '429': { description: 'Rate limited' },
        },
      };
    }
    paths[path] = entry;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'CallDeskTech API',
      version: '1.0.0',
      description:
        'Build, publish and operate voice agents. Authenticate with `Authorization: Bearer cdk_live_…` (create keys in Settings → API Keys). A key is pinned to one workspace; call `GET /me` to get its tenant id.',
    },
    servers: [{ url: serverUrl }],
    security: [{ apiKey: [] }],
    components: { securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'cdk_live_… API key' } } },
    paths,
  };
}
