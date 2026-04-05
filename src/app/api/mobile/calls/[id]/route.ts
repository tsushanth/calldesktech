import { NextRequest, NextResponse } from 'next/server';
import { getMobileUser } from '@/lib/mobile-auth';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/mobile/calls/[id]
 *
 * Returns a single call log with transcript and extracted data.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const mobileUser = await getMobileUser(request);
    if (!mobileUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const supabase = getSupabaseAdmin();

    // Get call log
    const { data: call, error } = await supabase
      .from('call_logs')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !call) {
      return NextResponse.json({ error: 'Call not found' }, { status: 404 });
    }

    // Verify ownership through tenant
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('id', call.tenant_id)
      .eq('user_id', mobileUser.id)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json(call);
  } catch (error) {
    console.error('Call detail error:', error);
    return NextResponse.json({ error: 'Failed to fetch call' }, { status: 500 });
  }
}
