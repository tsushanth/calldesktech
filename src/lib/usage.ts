import { SupabaseClient } from '@supabase/supabase-js';

// Shared usage-computation helpers. Both the billing page (billing/route.ts)
// and the usage page (usage/route.ts) independently re-derive "minutes this
// period" from calldesk_call_logs; this is the one place that math lives so
// the Stripe usage-reporting job (report-usage/route.ts) can't drift from
// what the dashboard shows the tenant.

export type CallOutcomeCounts = {
  calls: number;
  minutes: number;
  bookings: number;
  transfers: number;
  messages: number;
};

// Sums calldesk_call_logs.duration_seconds -> whole minutes, rounded the
// same way billing/route.ts and usage/route.ts already do (Math.round of
// the total, not per-call rounding, so partial minutes across many short
// calls aren't over-counted).
export function summarizeCallLogs(
  rows: Array<{ duration_seconds: number | null; outcome: string | null }>
): CallOutcomeCounts {
  const totalSeconds = rows.reduce((sum, c) => sum + (c.duration_seconds ?? 0), 0);
  return {
    calls: rows.length,
    minutes: Math.round(totalSeconds / 60),
    bookings: rows.filter((c) => c.outcome === 'booked').length,
    transfers: rows.filter((c) => c.outcome === 'transferred').length,
    messages: rows.filter((c) => c.outcome === 'voicemail').length,
  };
}

// Fetches calldesk_call_logs for a tenant in [since, until) and summarizes
// them. `since` null means "from the beginning" (never-reported tenant).
export async function getTenantUsageSince(
  supabase: SupabaseClient,
  tenantId: string,
  since: Date | null,
  until: Date = new Date()
): Promise<CallOutcomeCounts> {
  let query = supabase
    .from('calldesk_call_logs')
    .select('duration_seconds, outcome')
    .eq('tenant_id', tenantId)
    .lt('created_at', until.toISOString());

  if (since) {
    query = query.gte('created_at', since.toISOString());
  }

  const { data, error } = await query;
  if (error) throw error;
  return summarizeCallLogs(data ?? []);
}
