// API client for CallDeskTech - Uses Supabase directly for storage
// API routes are only used for external services (Retell AI, etc.)

import { getSupabase } from './supabase';
import type { Database } from '@/types/database';
import type { RetellVoice } from './retell';

type Tables = Database['public']['Tables'];
type Tenant = Tables['tenants']['Row'];
type TenantInsert = Tables['tenants']['Insert'];
type TenantUpdate = Tables['tenants']['Update'];
type KnowledgeBase = Tables['knowledge_bases']['Row'];
type KnowledgeBaseInsert = Tables['knowledge_bases']['Insert'];
type KnowledgeItem = Tables['knowledge_items']['Row'];
type KnowledgeItemInsert = Tables['knowledge_items']['Insert'];
type KnowledgeDocument = Tables['knowledge_documents']['Row'];
type ConversationFlow = Tables['conversation_flows']['Row'];
type CallLog = Tables['call_logs']['Row'];
type Booking = Tables['bookings']['Row'];
type ChatSession = Tables['chat_sessions']['Row'];
type ChatMessage = Tables['chat_messages']['Row'];

// A chat session as returned by the list endpoint — the row plus a derived
// message count (there's no column for it; it's computed server-side).
export interface ChatSessionSummary {
  id: string;
  tenant_id: string;
  agent_version_id: string | null;
  created_at: string;
  ended_at: string | null;
  message_count: number;
}

// The QA dashboard's row shape — the QA fields plus the call identity/context
// columns, without the heavy `transcript`. Mirrors the /qa route's select.
type CallQa = Pick<
  CallLog,
  | 'id'
  | 'caller_phone'
  | 'outcome'
  | 'duration_seconds'
  | 'created_at'
  | 'qa_status'
  | 'qa_sentiment'
  | 'qa_score'
  | 'qa_critique'
  | 'qa_analyzed_at'
>;

export interface RunCallQaResponse {
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
}

export interface CreateTenantRequest {
  name: string;
  userId: string;
  areaCode?: string;
  voiceEngine?: string;
}

export interface CreateTenantResponse {
  id: string;
  name: string;
  phone_number?: string;
  retell_agent_id?: string;
  retell_llm_id?: string;
}

export interface DemoCallRequest {
  tenant_id?: string;
  profile_id?: string;
  phone_number: string;
}

export interface DemoCallResponse {
  success: boolean;
  call_id: string;
  status: string;
  message: string;
}

export interface CallStatusResponse {
  call_id: string;
  status: string;
  duration: number;
  transcript?: Array<{ role: string; content: string }>;
}

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

// API Client class using Supabase
class ApiClient {
  private getSupabaseClient() {
    return getSupabase();
  }

  // Tenant operations - Direct Supabase queries
  async createTenant(data: CreateTenantRequest): Promise<CreateTenantResponse> {
    // For full tenant creation with Retell integration, use the API route
    const response = await fetch('/api/tenants', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': data.userId,
      },
      body: JSON.stringify({
        name: data.name,
        areaCode: data.areaCode,
        voiceEngine: data.voiceEngine,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(error.error || 'Failed to create tenant');
    }

    // API returns { tenant: {...} }, extract the tenant object
    const result = await response.json();
    const tenant = result.tenant;

    return {
      id: tenant.id,
      name: tenant.name,
      phone_number: tenant.phone_number,
      retell_agent_id: tenant.retell_agent_id,
      retell_llm_id: tenant.retell_llm_id,
    };
  }

  async getTenants(userId: string): Promise<Tenant[]> {
    const supabase = this.getSupabaseClient();
    const { data, error } = await supabase
      .from('calldesk_tenants')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new ApiError(error.message);
    return data || [];
  }

  // The methods below used to query calldesk_* tables directly from the
  // browser with the anon key. RLS on those tables checks
  // `auth.uid()::text = user_id`, but this app authenticates via NextAuth
  // (Google), not Supabase Auth — auth.uid() is always NULL for an anon-key
  // request here, so every one of these silently returned nothing (or
  // errored) in production since the app's first deploy. Routed through
  // server-side API routes (service role key) instead, the same pattern
  // already used everywhere else in this API surface.
  async getTenant(tenantId: string): Promise<Tenant | null> {
    const res = await fetch(`/api/tenants/${tenantId}`);
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error || 'Failed to load tenant');
    return body.tenant;
  }

  async updateTenant(tenantId: string, updates: TenantUpdate): Promise<Tenant> {
    const res = await fetch(`/api/tenants/${tenantId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error || 'Failed to update tenant');
    return body.tenant;
  }

  // Knowledge base operations
  async getKnowledgeBases(tenantId: string): Promise<KnowledgeBase[]> {
    const res = await fetch(`/api/tenants/${tenantId}/knowledge-bases`);
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error || 'Failed to load knowledge bases');
    return body.knowledgeBases || [];
  }

  async createKnowledgeBase(data: KnowledgeBaseInsert): Promise<KnowledgeBase> {
    const { tenant_id, ...rest } = data as KnowledgeBaseInsert & { tenant_id: string };
    const res = await fetch(`/api/tenants/${tenant_id}/knowledge-bases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rest),
    });
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error || 'Failed to create knowledge base');
    return body.knowledgeBase;
  }

  async getKnowledgeDocuments(knowledgeBaseId: string): Promise<KnowledgeDocument[]> {
    const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/documents`);
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error || 'Failed to load documents');
    return body.documents || [];
  }

  async addKnowledgeDocument(
    knowledgeBaseId: string,
    data: { type: 'website'; sourceUrl: string; title?: string } | { type: 'text'; text: string; title?: string }
  ): Promise<KnowledgeDocument> {
    const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error || 'Failed to add document');
    return body.document;
  }

  async deleteKnowledgeBase(knowledgeBaseId: string): Promise<void> {
    const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}`, { method: 'DELETE' });
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error || 'Failed to delete knowledge base');
  }

  async getKnowledgeItems(knowledgeBaseId: string): Promise<KnowledgeItem[]> {
    const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/items`);
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error || 'Failed to load knowledge items');
    return body.items || [];
  }

  async addKnowledgeItems(items: KnowledgeItemInsert[]): Promise<KnowledgeItem[]> {
    const knowledgeBaseId = (items[0] as KnowledgeItemInsert & { knowledge_base_id: string })?.knowledge_base_id;
    const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error || 'Failed to add knowledge items');
    return body.items || [];
  }

  // Conversation flow operations - Direct Supabase queries
  async getFlows(tenantId: string): Promise<ConversationFlow[]> {
    const supabase = this.getSupabaseClient();
    const { data, error } = await supabase
      .from('calldesk_conversation_flows')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw new ApiError(error.message);
    return data || [];
  }

  async getActiveFlow(tenantId: string): Promise<ConversationFlow | null> {
    const supabase = this.getSupabaseClient();
    const { data, error } = await supabase
      .from('calldesk_conversation_flows')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new ApiError(error.message);
    }
    return data;
  }

  // Call logs
  async getCallLogs(tenantId: string, limit = 50): Promise<CallLog[]> {
    const res = await fetch(`/api/tenants/${tenantId}/calls?limit=${limit}`);
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error || 'Failed to load call logs');
    return body.callLogs || [];
  }

  async getCallLog(callLogId: string): Promise<CallLog | null> {
    const res = await fetch(`/api/calls/${callLogId}`);
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error || 'Failed to load call log');
    return body.callLog;
  }

  // Chat sessions (text channel) — server-side routes, same service-role
  // pattern as the voice call-log methods above.
  // Retell's real multi-provider voice catalog (elevenlabs, openai, cartesia,
  // minimax, fish_audio, platform) — see /api/retell/voices.
  async getRetellVoices(): Promise<RetellVoice[]> {
    const res = await fetch('/api/retell/voices');
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error || 'Failed to load voices');
    return body.voices || [];
  }

  async getChatSessions(tenantId: string, limit = 100): Promise<ChatSessionSummary[]> {
    const res = await fetch(`/api/tenants/${tenantId}/chat-sessions?limit=${limit}`);
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error || 'Failed to load chat sessions');
    return body.chatSessions || [];
  }

  async getChatSession(sessionId: string): Promise<{ session: ChatSession | null; messages: ChatMessage[] }> {
    const res = await fetch(`/api/chat-sessions/${sessionId}`);
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error || 'Failed to load chat session');
    return { session: body.chatSession, messages: body.messages || [] };
  }

  // AI Quality Assurance
  async getCallQa(tenantId: string, limit = 100): Promise<CallQa[]> {
    const res = await fetch(`/api/tenants/${tenantId}/qa?limit=${limit}`);
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error || 'Failed to load QA results');
    return body.calls || [];
  }

  // Backfills QA for calls that have a transcript but no score yet. Returns how
  // many were processed. New calls are scored automatically by the webhook.
  async runCallQa(tenantId: string): Promise<RunCallQaResponse> {
    const res = await fetch(`/api/tenants/${tenantId}/qa/run`, { method: 'POST' });
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error || 'Failed to run QA');
    return body;
  }

  // Bookings - Direct Supabase queries
  async getBookings(tenantId: string, limit = 50): Promise<Booking[]> {
    const supabase = this.getSupabaseClient();
    const { data, error } = await supabase
      .from('calldesk_bookings')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('scheduled_time', { ascending: true })
      .limit(limit);

    if (error) throw new ApiError(error.message);
    return data || [];
  }

  async getUpcomingBookings(tenantId: string): Promise<Booking[]> {
    const supabase = this.getSupabaseClient();
    const { data, error } = await supabase
      .from('calldesk_bookings')
      .select('*')
      .eq('tenant_id', tenantId)
      .gte('scheduled_time', new Date().toISOString())
      .order('scheduled_time', { ascending: true });

    if (error) throw new ApiError(error.message);
    return data || [];
  }

  // Demo call - Uses API route (needs server-side Retell integration)
  async initiateDemoCall(data: DemoCallRequest): Promise<DemoCallResponse> {
    const response = await fetch('/api/demo-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(error.error || 'Failed to initiate call');
    }

    return response.json();
  }

  async getCallStatus(callId: string): Promise<CallStatusResponse> {
    const response = await fetch(`/api/demo-call/${callId}/status`);

    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(error.error || 'Failed to get call status');
    }

    return response.json();
  }

  async getTranscript(callId: string): Promise<TranscriptResponse> {
    const response = await fetch(`/api/demo-call/${callId}/transcript`);

    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(error.error || 'Failed to get transcript');
    }

    return response.json();
  }

  // Analytics/Stats
  async getCallStats(tenantId: string): Promise<{
    totalCalls: number;
    todayCalls: number;
    totalBookings: number;
    avgDuration: number;
  }> {
    const res = await fetch(`/api/tenants/${tenantId}/stats`);
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error || 'Failed to load stats');
    return body;
  }

  async getAnalytics(tenantId: string): Promise<AnalyticsResponse> {
    const res = await fetch(`/api/tenants/${tenantId}/analytics`);
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error || 'Failed to load analytics');
    return body;
  }
}

export type CallOutcome = 'booked' | 'answered' | 'transferred' | 'voicemail' | 'abandoned';

export interface AnalyticsResponse {
  windowDays: number;
  totalCalls: number;
  volume: Array<{ date: string; calls: number }>;
  duration: Array<{ date: string; avgDuration: number | null }>;
  outcomes: Array<{ outcome: CallOutcome; count: number }>;
  byHour: Array<{ hour: number; calls: number }>;
}

// Custom error class
export class ApiError extends Error {
  constructor(
    message: string,
    public details?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Export singleton instance
export const api = new ApiClient();

// Re-export types
export type {
  Tenant,
  TenantInsert,
  KnowledgeBase,
  KnowledgeBaseInsert,
  KnowledgeItem,
  KnowledgeItemInsert,
  KnowledgeDocument,
  ConversationFlow,
  CallLog,
  CallQa,
  Booking,
  ChatSession,
  ChatMessage,
};
