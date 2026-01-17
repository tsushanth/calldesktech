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
  type: 'greeting' | 'extraction' | 'function' | 'knowledge_base' | 'transfer' | 'goodbye';
  prompt: string;
  extract?: Record<string, string>;
  function?: string;
  params?: Record<string, string>;
  edges: FlowEdge[];
  position?: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  condition: string;
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
}
