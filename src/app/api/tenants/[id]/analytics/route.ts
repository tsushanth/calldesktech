import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

// GET /api/tenants/[id]/analytics — server-side aggregation of
// calldesk_call_logs for the Analytics dashboard. Mirrors the stats route:
// the browser can't query calldesk_* directly (RLS blocks the anon key since
// the app authenticates via NextAuth, not Supabase Auth), so all aggregation
// happens here with the service-role client. No new tracking — everything is
// derived from columns the call logs already have (created_at, outcome,
// duration_seconds).
//
// All day/hour bucketing is done in UTC. We don't persist a per-tenant
// timezone, so "calls by hour" reflects UTC wall-clock time.

const OUTCOMES = ['booked', 'answered', 'transferred', 'voicemail', 'abandoned'] as const;
const WINDOW_DAYS = 30;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();

  // Start of the window: midnight UTC, WINDOW_DAYS-1 days ago (inclusive of today).
  const now = new Date();
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  windowStart.setUTCDate(windowStart.getUTCDate() - (WINDOW_DAYS - 1));

  const { data, error } = await supabase
    .from('calldesk_call_logs')
    .select('created_at, outcome, duration_seconds')
    .eq('tenant_id', tenantId)
    .gte('created_at', windowStart.toISOString())
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data || [];

  // Pre-seed every day bucket in the window so the line/area charts are
  // continuous even on days with zero calls.
  const dayCount = new Map<string, number>();
  const dayDurationSum = new Map<string, number>();
  const dayLabels: string[] = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const d = new Date(windowStart);
    d.setUTCDate(d.getUTCDate() + i);
    const key = dayKey(d);
    dayLabels.push(key);
    dayCount.set(key, 0);
    dayDurationSum.set(key, 0);
  }

  const outcomeCount: Record<string, number> = Object.fromEntries(OUTCOMES.map((o) => [o, 0]));
  const hourCount = new Array(24).fill(0);

  for (const row of rows) {
    const created = new Date(row.created_at);
    const key = dayKey(created);
    if (dayCount.has(key)) {
      dayCount.set(key, (dayCount.get(key) || 0) + 1);
      dayDurationSum.set(key, (dayDurationSum.get(key) || 0) + (row.duration_seconds || 0));
    }
    if (row.outcome && row.outcome in outcomeCount) {
      outcomeCount[row.outcome] += 1;
    }
    hourCount[created.getUTCHours()] += 1;
  }

  const volume = dayLabels.map((date) => ({ date, calls: dayCount.get(date) || 0 }));

  const duration = dayLabels.map((date) => {
    const count = dayCount.get(date) || 0;
    // null (not 0) on no-call days so the trend line gaps instead of dropping
    // to a misleading zero.
    const avgDuration = count > 0 ? Math.round((dayDurationSum.get(date) || 0) / count) : null;
    return { date, avgDuration };
  });

  const outcomes = OUTCOMES.map((outcome) => ({ outcome, count: outcomeCount[outcome] }));

  const byHour = hourCount.map((calls, hour) => ({ hour, calls }));

  return NextResponse.json({
    windowDays: WINDOW_DAYS,
    totalCalls: rows.length,
    volume,
    duration,
    outcomes,
    byHour,
  });
}
