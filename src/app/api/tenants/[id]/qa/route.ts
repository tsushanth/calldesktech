import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

// GET /api/tenants/[id]/qa — call logs with their AI Quality Assurance results
// for the QA dashboard. Server-side / service-role only (the client never hits
// Supabase directly), mirroring /api/tenants/[id]/calls. The heavy `transcript`
// column is deliberately excluded — the list view only needs QA fields.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const limit = Number(request.nextUrl.searchParams.get('limit')) || 100;
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('calldesk_call_logs')
    .select(
      'id, caller_phone, outcome, duration_seconds, created_at, qa_status, qa_sentiment, qa_score, qa_critique, qa_analyzed_at'
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ calls: data || [] });
}
