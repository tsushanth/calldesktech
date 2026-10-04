import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';
import { isPilotBlockedCall } from '@/lib/pilotBlockShared';

// GET /api/tenants/[id]/stats — see tenants/[id]/route.ts for why this
// replaces a direct (RLS-blocked) client-side Supabase call (Overview's
// stat cards never actually populated in production before this).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [{ count: totalBookings }, { data: callRows }] = await Promise.all([
    supabase.from('calldesk_bookings').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabase.from('calldesk_call_logs').select('created_at, duration_seconds, analysis').eq('tenant_id', tenantId),
  ]);
  // Calls the engine turned away for a blocked pilot (analysis.blocked === 'pilot') are not customer calls.
  const durationData = (callRows || []).filter((r) => !isPilotBlockedCall(r));
  const totalCalls = durationData.length;
  const todayCalls = durationData.filter((r) => new Date(r.created_at) >= today).length;

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
