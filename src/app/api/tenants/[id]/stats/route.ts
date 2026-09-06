import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// GET /api/tenants/[id]/stats — see tenants/[id]/route.ts for why this
// replaces a direct (RLS-blocked) client-side Supabase call (Overview's
// stat cards never actually populated in production before this).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [{ count: totalCalls }, { count: todayCalls }, { count: totalBookings }, { data: durationData }] = await Promise.all([
    supabase.from('calldesk_call_logs').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabase.from('calldesk_call_logs').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('created_at', today.toISOString()),
    supabase.from('calldesk_bookings').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabase.from('calldesk_call_logs').select('duration_seconds').eq('tenant_id', tenantId),
  ]);

  const avgDuration =
    durationData && durationData.length > 0
      ? durationData.reduce((sum, call) => sum + (call.duration_seconds || 0), 0) / durationData.length
      : 0;

  return NextResponse.json({
    totalCalls: totalCalls || 0,
    todayCalls: todayCalls || 0,
    totalBookings: totalBookings || 0,
    avgDuration: Math.round(avgDuration),
  });
}
