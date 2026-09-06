import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// GET /api/tenants/[id]/calls — replaces src/lib/api.ts's direct (RLS-blocked
// anon-key) query against calldesk_call_logs. See src/app/api/tenants/[id]/
// route.ts for the full explanation of why the direct-client pattern never
// actually worked in production.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params;
  const limit = Number(request.nextUrl.searchParams.get('limit')) || 50;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_call_logs')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ callLogs: data || [] });
}
