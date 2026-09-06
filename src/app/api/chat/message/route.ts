import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchKnowledgeItems } from '@/lib/chatFlowResolver';
import { runUserTurn, type EngineFlow, type EngineState, type EngineMessage } from '@/lib/textFlowEngine';

// POST /api/chat/message — a visitor sends one message in an open session.
// Public (no auth), same as /api/chat/session. Loads the session's snapshotted
// flow + engine state and full transcript, runs one visitor turn through the
// text flow engine, and persists the visitor message plus every assistant
// message the turn produced (an auto-advance chain can produce several).
export async function POST(request: NextRequest) {
  let body: { sessionId?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const sessionId = body.sessionId?.trim();
  const text = body.text?.trim();
  if (!sessionId || !text) {
    return NextResponse.json({ error: 'sessionId and text are required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: session, error: sessionError } = await supabase
    .from('calldesk_chat_sessions')
    .select('id, flow_snapshot, state, ended_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });
  if (!session) return NextResponse.json({ error: 'Unknown session' }, { status: 404 });
  if (session.ended_at) {
    return NextResponse.json({ error: 'This chat has ended' }, { status: 409 });
  }

  // Rebuild the running history from the persisted transcript. KB/function
  // system notes are transient (added inside the engine per turn) and were
  // never stored, so this is just the visible visitor/assistant turns.
  const { data: priorMessages, error: histError } = await supabase
    .from('calldesk_chat_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (histError) return NextResponse.json({ error: histError.message }, { status: 500 });

  const history: EngineMessage[] = (priorMessages || []).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const flow = (session.flow_snapshot as EngineFlow | null) || null;
  const state = (session.state as EngineState) || { currentNodeId: '', collectedData: {} };

  let result;
  try {
    result = await runUserTurn(flow, state, history, text, { fetchKnowledgeItems });
  } catch (err) {
    console.error('[chat] user turn failed', err);
    return NextResponse.json({ error: 'Failed to generate a reply' }, { status: 502 });
  }

  // Persist the visitor's message, then the assistant reply(s), in order.
  const rows = [
    { session_id: sessionId, role: 'user' as const, content: text },
    ...result.assistantMessages.map((content) => ({
      session_id: sessionId,
      role: 'assistant' as const,
      content,
    })),
  ];
  const { error: insertError } = await supabase.from('calldesk_chat_messages').insert(rows);
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  const { error: updateError } = await supabase
    .from('calldesk_chat_sessions')
    .update({
      state: result.state,
      ended_at: result.ended ? new Date().toISOString() : null,
    })
    .eq('id', sessionId);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({
    messages: result.assistantMessages.map((content) => ({ role: 'assistant', content })),
    ended: result.ended,
  });
}
