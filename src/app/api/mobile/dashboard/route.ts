import { NextRequest, NextResponse } from 'next/server';
import { getMobileUser } from '@/lib/mobile-auth';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/mobile/dashboard?tenant_id=
 *
 * Returns combined dashboard stats + recent calls in a single request.
 * Optimized for mobile to reduce network round trips.
 */
export async function GET(request: NextRequest) {
  try {
    const mobileUser = await getMobileUser(request);
    if (!mobileUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = request.nextUrl.searchParams.get('tenant_id');
    if (!tenantId) {
      return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Verify tenant ownership
    const { data: tenant, error: tenantError } = await supabase
      .from('calldesk_tenants')
      .select('id')
      .eq('id', tenantId)
      .eq('user_id', mobileUser.id)
      .single();

    if (tenantError || !tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Run all queries in parallel
    const [
      totalCallsResult,
      todayCallsResult,
      totalBookingsResult,
      durationResult,
      recentCallsResult,
    ] = await Promise.all([
      supabase
        .from('calldesk_call_logs')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId),
      supabase
        .from('calldesk_call_logs')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .gte('created_at', today.toISOString()),
      supabase
        .from('calldesk_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId),
      supabase
        .from('calldesk_call_logs')
        .select('duration_seconds')
        .eq('tenant_id', tenantId),
      supabase
        .from('calldesk_call_logs')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    const durations = durationResult.data || [];
    const avgDuration = durations.length > 0
      ? Math.round(durations.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) / durations.length)
      : 0;

    return NextResponse.json({
      stats: {
        total_calls: totalCallsResult.count || 0,
        today_calls: todayCallsResult.count || 0,
        total_bookings: totalBookingsResult.count || 0,
        avg_duration: avgDuration,
      },
      recent_calls: recentCallsResult.data || [],
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }
}
