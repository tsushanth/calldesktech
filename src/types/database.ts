export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string
          user_id: string
          name: string
          phone_number: string | null
          retell_agent_id: string | null
          retell_llm_id: string | null
          cal_api_key: string | null
          cal_event_type_id: string | null
          knowledge_base_id: string | null
          settings: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          phone_number?: string | null
          retell_agent_id?: string | null
          retell_llm_id?: string | null
          cal_api_key?: string | null
          cal_event_type_id?: string | null
          knowledge_base_id?: string | null
          settings?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          phone_number?: string | null
          retell_agent_id?: string | null
          retell_llm_id?: string | null
          cal_api_key?: string | null
          cal_event_type_id?: string | null
          knowledge_base_id?: string | null
          settings?: Json | null
          created_at?: string
          updated_at?: string
        }
      }
      conversation_flows: {
        Row: {
          id: string
          tenant_id: string
          name: string
          nodes: Json
          global_settings: Json
          is_active: boolean
          version: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          nodes: Json
          global_settings: Json
          is_active?: boolean
          version?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          name?: string
          nodes?: Json
          global_settings?: Json
          is_active?: boolean
          version?: number
          created_at?: string
          updated_at?: string
        }
      }
      knowledge_bases: {
        Row: {
          id: string
          tenant_id: string
          name: string
          source_type: 'website' | 'pdf' | 'manual'
          source_url: string | null
          retell_kb_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          source_type: 'website' | 'pdf' | 'manual'
          source_url?: string | null
          retell_kb_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          name?: string
          source_type?: 'website' | 'pdf' | 'manual'
          source_url?: string | null
          retell_kb_id?: string | null
          created_at?: string
        }
      }
      knowledge_items: {
        Row: {
          id: string
          knowledge_base_id: string
          question: string
          answer: string
          created_at: string
        }
        Insert: {
          id?: string
          knowledge_base_id: string
          question: string
          answer: string
          created_at?: string
        }
        Update: {
          id?: string
          knowledge_base_id?: string
          question?: string
          answer?: string
          created_at?: string
        }
      }
      call_logs: {
        Row: {
          id: string
          tenant_id: string
          retell_call_id: string
          caller_phone: string
          outcome: 'booked' | 'answered' | 'transferred' | 'voicemail' | 'abandoned'
          duration_seconds: number
          transcript: Json | null
          extracted_data: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          retell_call_id: string
          caller_phone: string
          outcome: 'booked' | 'answered' | 'transferred' | 'voicemail' | 'abandoned'
          duration_seconds?: number
          transcript?: Json | null
          extracted_data?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          retell_call_id?: string
          caller_phone?: string
          outcome?: 'booked' | 'answered' | 'transferred' | 'voicemail' | 'abandoned'
          duration_seconds?: number
          transcript?: Json | null
          extracted_data?: Json | null
          created_at?: string
        }
      }
      bookings: {
        Row: {
          id: string
          tenant_id: string
          call_log_id: string | null
          caller_name: string
          caller_email: string | null
          caller_phone: string
          service_type: string | null
          scheduled_time: string
          cal_booking_id: string | null
          status: 'pending' | 'confirmed' | 'cancelled'
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          call_log_id?: string | null
          caller_name: string
          caller_email?: string | null
          caller_phone: string
          service_type?: string | null
          scheduled_time: string
          cal_booking_id?: string | null
          status?: 'pending' | 'confirmed' | 'cancelled'
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          call_log_id?: string | null
          caller_name?: string
          caller_email?: string | null
          caller_phone?: string
          service_type?: string | null
          scheduled_time?: string
          cal_booking_id?: string | null
          status?: 'pending' | 'confirmed' | 'cancelled'
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
