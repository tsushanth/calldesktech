import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// GET /api/chat-sessions/[id] — one chat session plus its full transcript, for
// the Chat History detail view. Service-role, same as /api/calls/[id].
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: session, error } = await supabase
    .from('calldesk_chat_sessions')
    .select('id, tenant_id, agent_version_id, state, created_at, ended_at')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!session) return NextResponse.json({ chatSession: null, messages: [] });

  const { data: messages, error: msgError } = await supabase
    .from('calldesk_chat_messages')
    .select('id, role, content, created_at')
    .eq('session_id', id)
    .order('created_at', { ascending: true });
  if (msgError) return NextResponse.json({ error: msgError.message }, { status: 500 });

  return NextResponse.json({ chatSession: session, messages: messages || [] });
}
