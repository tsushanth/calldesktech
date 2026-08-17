import { NextRequest, NextResponse } from 'next/server';
import { getMobileUser } from '@/lib/mobile-auth';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/mobile/calls?tenant_id=&limit=&offset=&outcome=&search=
 *
 * Paginated call logs with optional filtering.
 */
export async function GET(request: NextRequest) {
  try {
    const mobileUser = await getMobileUser(request);
    if (!mobileUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const params = request.nextUrl.searchParams;
    const tenantId = params.get('tenant_id');
    const limit = parseInt(params.get('limit') || '20', 10);
    const offset = parseInt(params.get('offset') || '0', 10);
    const outcome = params.get('outcome');
    const search = params.get('search');

    if (!tenantId) {
      return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Verify ownership
    const { data: tenant } = await supabase
      .from('calldesk_tenants')
      .select('id')
      .eq('id', tenantId)
      .eq('user_id', mobileUser.id)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Build query
    let query = supabase
      .from('calldesk_call_logs')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (outcome) {
      query = query.eq('outcome', outcome);
    }

    if (search) {
      query = query.ilike('caller_phone', `%${search}%`);
    }

    const { data, count, error } = await query;

    if (error) {
      console.error('Calls query error:', error);
      return NextResponse.json({ error: 'Failed to fetch calls' }, { status: 500 });
    }

    return NextResponse.json({
      calls: data || [],
      total: count || 0,
    });
  } catch (error) {
    console.error('Calls error:', error);
    return NextResponse.json({ error: 'Failed to fetch calls' }, { status: 500 });
  }
}
