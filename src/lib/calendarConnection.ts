import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * Whether the tenant has a Cal.com connection the engine can use (a row in calldesk_calendar_connections, which the engine's tenant
 * lookup reads). Tolerant: a missing table or any query error reads as "not connected" so a hint can never break a publish.
 */
export async function tenantHasCalendar(tenantId: string): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('calldesk_calendar_connections')
      .select('id')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    return !error && !!data;
  } catch {
    return false;
  }
}
