import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured');
  }
  return url;
}

function getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured');
  }
  return key;
}

// Lazy-loaded client-side Supabase client
let supabaseInstance: SupabaseClient<Database> | null = null;

export function getSupabase(): SupabaseClient<Database> {
  if (!supabaseInstance) {
    supabaseInstance = createClient<Database>(getSupabaseUrl(), getSupabaseAnonKey());
  }
  return supabaseInstance;
}

// Server-side Supabase client (full permissions)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSupabaseAdmin(): SupabaseClient<any> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }
  // Using 'any' to avoid strict type checking during development
  // In production, regenerate types from Supabase
  return createClient(getSupabaseUrl(), serviceRoleKey);
}

// For backwards compatibility
export const supabase = {
  get client() {
    return getSupabase();
  }
};
