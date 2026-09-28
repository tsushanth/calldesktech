import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

// GET /api/tenants/[id]/usage — billing and usage breakdown.
// Aggregates from calldesk_call_logs, calldesk_sms_messages, and
// calldesk_phone_numbers for a date range.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;
  const tenantId = (await params).id;
  const { searchParams } = new URL(request.url);

  const today = new Date().toISOString().split('T')[0];
  const startDate = (searchParams.get('startDate') ?? today.slice(0, 8) + '01'); // start of current month
  const endDate = (searchParams.get('endDate') ?? today);
  const granularity = (searchParams.get('granularity') ?? 'day') as 'day' | 'month';

  const supabase = getSupabaseAdmin();

  // Call minutes
  const { data: callsAgg } = await supabase
    .from('calldesk_call_logs')
    .select('created_at, duration_seconds')
    .eq('tenant_id', tenantId)
    .gte('created_at', `${startDate}T00:00:00Z`)
    .lte('created_at', `${endDate}T23:59:59Z`);

  const callMinutes = Math.round(
    (callsAgg || []).reduce((sum, c) => sum + (c.duration_seconds ?? 0), 0) / 60
  );

  // SMS count (segments approx = message count for now)
  const { data: smsAgg } = await supabase
    .from('calldesk_sms_messages')
    .select('created_at')
    .eq('tenant_id', tenantId)
    .eq('direction', 'outbound')
    .gte('created_at', `${startDate}T00:00:00Z`)
    .lte('created_at', `${endDate}T23:59:59Z`);

  const smsMessages = (smsAgg || []).length;
  // Estimate segments (conservative: every 153 chars is a segment for GSM-7)
  const smsSegments = smsMessages; // Start simple; we don't store char count

  // Number rental: count active numbers × $2/month (flat estimate)
  const { count: numberCount } = await supabase
    .from('calldesk_phone_numbers')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  const numberCost = (numberCount ?? 0) * 2.0;

  // Granular series
  const seriesMap = new Map<string, { callMinutes: number; smsCount: number }>();
  const dateKey = (date: string) => {
    const d = new Date(date);
    return granularity === 'month'
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      : date.split('T')[0];
  };

  for (const c of callsAgg || []) {
    const key = dateKey(c.created_at);
    const entry = seriesMap.get(key) ?? { callMinutes: 0, smsCount: 0 };
    entry.callMinutes += Math.round((c.duration_seconds ?? 0) / 60);
    seriesMap.set(key, entry);
  }
  for (const s of smsAgg || []) {
    const key = dateKey(s.created_at);
    const entry = seriesMap.get(key) ?? { callMinutes: 0, smsCount: 0 };
    entry.smsCount += 1;
    seriesMap.set(key, entry);
  }

  const series = Array.from(seriesMap.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return NextResponse.json({
    startDate,
    endDate,
    granularity,
    totals: { callMinutes, smsMessages, smsSegments, numberCost },
    series,
  });
}
