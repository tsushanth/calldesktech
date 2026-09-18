// Tenant Types
export interface Tenant {
  id: string;
  name: string;
  phoneNumber: string;
  retellAgentId: string;
  calApiKey?: string;
  calEventTypeId?: string;
  knowledgeBaseId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Conversation Flow Types
export interface FlowNode {
  id: string;
  type: 'greeting' | 'extraction' | 'function' | 'knowledge_base' | 'transfer' | 'goodbye' | 'payment' | 'logic_split' | 'press_digit' | 'sms' | 'code' | 'mcp' | 'subagent' | 'subflow_ref' | 'agent_transfer'
    // 'note' is a canvas-only sticky: stripped at publish, never sent to the engine.
    | 'note';
  // Optional only for 'logic_split' and 'press_digit' — neither speaks or
  // calls the LLM (call-loop-poc's server.js routes them in code: logic_split
  // from collectedData, press_digit via a real DTMF-tone detour), so
  // neither has a prompt to hold.
  prompt?: string;
  extract?: Record<string, string>;
  function?: string;
  // 'subflow_ref' params: subflowId (the referenced calldesk_subflows row),
  // plus subflowNodes/subflowStartNodeId which are populated at PUBLISH time
  // by embedding a snapshot of the referenced subflow's own nodes (see
  // publishSubflowRefs in versions/route.ts) — server.js executes purely off
  // that embedded snapshot, never a live subflow lookup, so a flow keeps
  // working even if the subflow is edited or deleted later.
  params?: Record<string, string>;
  edges: FlowEdge[];
  position?: { x: number; y: number };
}

// A reusable sub-graph of nodes, editable independently of any one flow and
// embeddable into a 'subflow_ref' node. 'library' scope is reusable across
// every agent in the tenant; 'agent' scope is visible only to the one agent
// that created it — matches the two tiers Retell's own UI exposes
// ("Agent Subflows" vs "Library Subflows").
export interface Subflow {
  id: string;
  tenantId: string;
  agentId: string | null; // null for library-scoped subflows
  scope: 'agent' | 'library';
  name: string;
  nodes: FlowNode[];
  startNodeId: string;
  createdAt: string;
  updatedAt: string;
}

// A 'logic_split' node's edges use StructuredCondition instead of free text
// — real deterministic evaluation against collectedData (see server.js's
// _evaluateStructuredCondition), the only condition shape in this codebase
// that isn't just handed to the LLM to judge. Every other node type keeps
// the free-text string, which stays LLM-judged as before.
export interface StructuredCondition {
  field: string;
  operator: '==' | '!=' | '>' | '<' | '>=' | '<=';
  value: string;
}

export interface FlowEdge {
  id: string;
  // A conditionless edge (condition omitted) on a logic_split node is an
  // explicit default/fallback — matches unconditionally if reached. Other
  // node types are expected to always set condition.
  condition?: string | StructuredCondition;
  target: string;
}

export interface ConversationFlow {
  id: string;
  tenantId: string;
  name: string;
  nodes: FlowNode[];
  globalSettings: GlobalSettings;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface GlobalSettings {
  allowInterruptions: boolean;
  returnToFlow: boolean;
  knowledgeBaseId?: string;
  voiceId?: string;
  language?: string;
  // Not a real column — folded in here so a flow's start node round-trips
  // through the existing global_settings JSONB without a schema change.
  startNodeId?: string;
}

// Agent / Version / Phone Number Types
// Raw snake_case shapes matching calldesk_agents/calldesk_agent_versions/
// calldesk_phone_numbers directly (see supabase/migrations/
// 005_agents_and_versions.sql) — kept snake_case rather than mapped to
// camelCase to match how the rest of this API layer already returns
// Supabase rows as-is (see src/lib/api.ts's Tenant/Flow types).
export interface Agent {
  id: string;
  tenant_id: string;
  name: string;
  mode: 'simple' | 'advanced';
  created_at: string;
  updated_at: string;
  // Only present from GET /api/tenants/[id]/agents (the list route), which
  // enriches each row with its latest version's engine/voice and any
  // routed phone numbers — not present on GET /api/agents/[id] (single
  // agent fetch), which returns the bare row.
  latestVersion?: {
    voiceEngine: string;
    voice: string | null;
    updatedAt: string;
  } | null;
  phoneNumbers?: string[];
}

// TTS backends the in-house ('poc') voice engine can run — kokoro
// (self-hosted) and elevenlabs were the original two; cartesia and minimax
// are additional providers call-loop-poc can call directly, each needing
// its own API key set on that Fly app (not calldesktech's). Not yet wired to
// a Stripe usage price (see USAGE_PRICES in lib/constants.ts) — that's a
// real billing decision, made once there's an account and a real rate to
// price against, not invented here.
export type TtsBackend = 'kokoro' | 'elevenlabs' | 'cartesia' | 'minimax';

export interface AgentVersion {
  id: string;
  agent_id: string;
  version_number: number;
  voice_engine: 'retell' | 'poc';
  flow_id: string | null;
  retell_agent_id: string | null;
  retell_llm_id: string | null;
  voice_id: string | null;
  tts_backend: TtsBackend | null;
  wizard_config: Record<string, unknown> | null;
  created_at: string;
}

export interface PhoneNumber {
  id: string;
  tenant_id: string;
  number: string;
  inbound_agent_version_id: string | null;
  outbound_agent_version_id: string | null;
  created_at: string;
  updated_at: string;
}

// Batch Call Types — see supabase/migrations/007_batch_calls.sql. A batch
// dials a list of numbers with one agent version; each target tracks its own
// dial state and links back to the call log it produced.
export interface BatchCall {
  id: string;
  tenant_id: string;
  agent_version_id: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  created_at: string;
  updated_at: string;
  // Attached by the list endpoint, not columns on the row itself.
  target_count?: number;
  called_count?: number;
  failed_count?: number;
}

export interface BatchCallTarget {
  id: string;
  batch_id: string;
  phone_number: string;
  status: 'pending' | 'calling' | 'failed';
  call_log_id: string | null;
  created_at: string;
}

// Knowledge Base Types
export interface KnowledgeBase {
  id: string;
  tenantId: string;
  name: string;
  sourceType: 'website' | 'pdf' | 'manual';
  sourceUrl?: string;
  content?: string;
  createdAt: Date;
}

export interface KnowledgeItem {
  id: string;
  knowledgeBaseId: string;
  question: string;
  answer: string;
}

// Call Log Types
export interface CallLog {
  id: string;
  tenantId: string;
  retellCallId: string;
  callerPhone: string;
  outcome: 'booked' | 'answered' | 'transferred' | 'voicemail' | 'abandoned';
  durationSeconds: number;
  transcript?: CallTranscript[];
  extractedData?: Record<string, unknown>;
  createdAt: Date;
}

export interface CallTranscript {
  role: 'agent' | 'user';
  content: string;
  timestamp: number;
}

// Transcript page types
export interface TranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
  turn_number?: number;
}

export interface CallerInsights {
  sentiment: string;
  urgency: string;
  decision_style: string;
  purchase_intent: string;
  price_sensitivity: string;
  key_concerns: string[];
  upsell_opportunities: string[];
  follow_up_recommendation: string;
  caller_profile_summary: string;
}

export interface TranscriptResponse {
  call_id: string;
  tenant_id: string;
  business_name: string;
  duration: number;
  started_at?: string;
  ended_at?: string;
  transcript: TranscriptTurn[];
  summary?: string;
  caller_intent?: string;
  actions_demonstrated?: string[];
  caller_insights?: CallerInsights;
  turn_count: number;
}

// Booking Types
export interface BookingSlot {
  startTime: string;
  endTime: string;
  available: boolean;
}

export interface BookingRequest {
  tenantId: string;
  callerName: string;
  callerEmail: string;
  callerPhone: string;
  serviceType?: string;
  preferredTime: string;
}

// Retell API Types
export interface RetellAgent {
  agent_id: string;
  agent_name: string;
  voice_id: string;
  llm_websocket_url: string;
  response_engine: ResponseEngine;
}

export interface ResponseEngine {
  type: 'retell-llm';
  llm_id: string;
}

export interface RetellWebhookEvent {
  event: 'call_started' | 'call_ended' | 'call_analyzed';
  call: RetellCallData;
}

export interface RetellCallData {
  call_id: string;
  agent_id: string;
  from_number: string;
  to_number: string;
  direction: 'inbound' | 'outbound';
  call_status: 'ongoing' | 'ended';
  start_timestamp: number;
  end_timestamp?: number;
  transcript?: string;
  recording_url?: string;
  // How the call ended, per Retell (e.g. 'call_transfer', 'voicemail_reached',
  // 'dial_no_answer', 'user_hangup'). Populated on call_ended/call_analyzed and
  // used to finalize our own outcome enum — see deriveOutcome in src/lib/alerts.ts.
  // Also used to fire the 'call.transferred' outbound webhook.
  disconnection_reason?: string;
}
