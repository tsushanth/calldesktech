import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

// GET /api/tenants/[id]/calls — replaces src/lib/api.ts's direct (RLS-blocked
// anon-key) query against calldesk_call_logs. See src/app/api/tenants/[id]/
// route.ts for the full explanation of why the direct-client pattern never
// actually worked in production.

// Added: transcript search via `?search=keyword`. Uses Postgres full-text
// search on the transcript column.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);
  const search = searchParams.get('search');

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('calldesk_call_logs')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (search) {
    // Full-text search on the transcript column
    query = query.textSearch('transcript_search', search, { type: 'websearch', config: 'english' });
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ callLogs: data || [] });
}
