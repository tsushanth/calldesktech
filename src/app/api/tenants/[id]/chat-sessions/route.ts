import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// GET /api/tenants/[id]/chat-sessions — list a tenant's text-chat sessions for
// the Chat History dashboard, newest first, each with its message count. Same
// service-role pattern as /api/tenants/[id]/calls (the anon key can't reach
// these RLS-protected tables from the browser).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params;
  const limit = Number(request.nextUrl.searchParams.get('limit')) || 50;
  const supabase = getSupabaseAdmin();

  const { data: sessions, error } = await supabase
    .from('calldesk_chat_sessions')
    .select('id, tenant_id, agent_version_id, created_at, ended_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (sessions || []).map((s) => s.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: msgs, error: msgError } = await supabase
      .from('calldesk_chat_messages')
      .select('session_id')
      .in('session_id', ids);
    if (msgError) return NextResponse.json({ error: msgError.message }, { status: 500 });
    for (const m of msgs || []) counts.set(m.session_id, (counts.get(m.session_id) || 0) + 1);
  }

  const withCounts = (sessions || []).map((s) => ({ ...s, message_count: counts.get(s.id) || 0 }));
  return NextResponse.json({ chatSessions: withCounts });
}
