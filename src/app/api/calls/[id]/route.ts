import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeResource } from '@/lib/authz';

// GET /api/calls/[id] — see tenants/[id]/route.ts for why this replaces a
// direct (RLS-blocked) client-side Supabase call.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_call_logs', (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_call_logs')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ callLog: data });
}
