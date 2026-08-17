// API client for CallDeskTech - Uses Supabase directly for storage
// API routes are only used for external services (Retell AI, etc.)

import { getSupabase } from './supabase';
import type { Database } from '@/types/database';

type Tables = Database['public']['Tables'];
type Tenant = Tables['tenants']['Row'];
type TenantInsert = Tables['tenants']['Insert'];
type TenantUpdate = Tables['tenants']['Update'];
type KnowledgeBase = Tables['knowledge_bases']['Row'];
type KnowledgeBaseInsert = Tables['knowledge_bases']['Insert'];
type KnowledgeItem = Tables['knowledge_items']['Row'];
type KnowledgeItemInsert = Tables['knowledge_items']['Insert'];
type ConversationFlow = Tables['conversation_flows']['Row'];
type CallLog = Tables['call_logs']['Row'];
type Booking = Tables['bookings']['Row'];

export interface CreateTenantRequest {
  name: string;
  userId: string;
  areaCode?: string;
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

  async getTenant(tenantId: string): Promise<Tenant | null> {
    const supabase = this.getSupabaseClient();
    const { data, error } = await supabase
      .from('calldesk_tenants')
      .select('*')
      .eq('id', tenantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new ApiError(error.message);
    }
    return data;
  }

  async updateTenant(tenantId: string, updates: TenantUpdate): Promise<Tenant> {
    const supabase = this.getSupabaseClient();
    const { data, error } = await supabase
      .from('calldesk_tenants')
      .update(updates)
      .eq('id', tenantId)
      .select()
      .single();

    if (error) throw new ApiError(error.message);
    return data as Tenant;
  }

  // Knowledge base operations - Direct Supabase queries
  async getKnowledgeBases(tenantId: string): Promise<KnowledgeBase[]> {
    const supabase = this.getSupabaseClient();
    const { data, error } = await supabase
      .from('calldesk_knowledge_bases')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw new ApiError(error.message);
    return data || [];
  }

  async createKnowledgeBase(data: KnowledgeBaseInsert): Promise<KnowledgeBase> {
    const supabase = this.getSupabaseClient();
    const { data: kb, error } = await supabase
      .from('calldesk_knowledge_bases')
      .insert(data)
      .select()
      .single();

    if (error) throw new ApiError(error.message);
    return kb;
  }

  async getKnowledgeItems(knowledgeBaseId: string): Promise<KnowledgeItem[]> {
    const supabase = this.getSupabaseClient();
    const { data, error } = await supabase
      .from('calldesk_knowledge_items')
      .select('*')
      .eq('knowledge_base_id', knowledgeBaseId)
      .order('created_at', { ascending: false });

    if (error) throw new ApiError(error.message);
    return data || [];
  }

  async addKnowledgeItems(items: KnowledgeItemInsert[]): Promise<KnowledgeItem[]> {
    const supabase = this.getSupabaseClient();
    const { data, error } = await supabase
      .from('calldesk_knowledge_items')
      .insert(items)
      .select();

    if (error) throw new ApiError(error.message);
    return data || [];
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

  // Call logs - Direct Supabase queries
  async getCallLogs(tenantId: string, limit = 50): Promise<CallLog[]> {
    const supabase = this.getSupabaseClient();
    const { data, error } = await supabase
      .from('calldesk_call_logs')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new ApiError(error.message);
    return data || [];
  }

  async getCallLog(callLogId: string): Promise<CallLog | null> {
    const supabase = this.getSupabaseClient();
    const { data, error } = await supabase
      .from('calldesk_call_logs')
      .select('*')
      .eq('id', callLogId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new ApiError(error.message);
    }
    return data;
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

  // Analytics/Stats - Direct Supabase queries
  async getCallStats(tenantId: string): Promise<{
    totalCalls: number;
    todayCalls: number;
    totalBookings: number;
    avgDuration: number;
  }> {
    const supabase = this.getSupabaseClient();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get total calls
    const { count: totalCalls } = await supabase
      .from('calldesk_call_logs')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    // Get today's calls
    const { count: todayCalls } = await supabase
      .from('calldesk_call_logs')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', today.toISOString());

    // Get total bookings
    const { count: totalBookings } = await supabase
      .from('calldesk_bookings')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    // Get average duration
    const { data: durationData } = await supabase
      .from('calldesk_call_logs')
      .select('duration_seconds')
      .eq('tenant_id', tenantId);

    const avgDuration = durationData && durationData.length > 0
      ? durationData.reduce((sum, call) => sum + (call.duration_seconds || 0), 0) / durationData.length
      : 0;

    return {
      totalCalls: totalCalls || 0,
      todayCalls: todayCalls || 0,
      totalBookings: totalBookings || 0,
      avgDuration: Math.round(avgDuration),
    };
  }
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
  ConversationFlow,
  CallLog,
  Booking,
};
