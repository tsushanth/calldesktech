import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveTenantChatFlow } from '@/lib/chatFlowResolver';
import { runOpeningTurn } from '@/lib/textFlowEngine';

// POST /api/chat/session — a website visitor opens the chat widget. Public
// (no auth): the same way the voice channel answers any caller. Resolves the
// tenant's agent-version flow, snapshots it onto the new session (so a mid-chat
// flow edit can't corrupt this conversation), runs the flow's opening turn, and
// persists both the session and its first assistant message(s).
export async function POST(request: NextRequest) {
  let body: { tenantId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const tenantId = body.tenantId?.trim();
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Confirm the tenant exists so we never open an orphan session for a bad id.
  const { data: tenant, error: tenantError } = await supabase
    .from('calldesk_tenants')
    .select('id, name')
    .eq('id', tenantId)
    .maybeSingle();
  if (tenantError) return NextResponse.json({ error: tenantError.message }, { status: 500 });
  if (!tenant) return NextResponse.json({ error: 'Unknown tenant' }, { status: 404 });

  const { agentVersionId, flow } = await resolveTenantChatFlow(tenantId);

  let opening;
  try {
    opening = await runOpeningTurn(flow);
  } catch (err) {
    console.error('[chat] opening turn failed', err);
    return NextResponse.json({ error: 'Failed to start chat' }, { status: 502 });
  }

  const { data: session, error: sessionError } = await supabase
    .from('calldesk_chat_sessions')
    .insert({
      tenant_id: tenantId,
      agent_version_id: agentVersionId,
      flow_snapshot: flow,
      state: opening.state,
      ended_at: opening.ended ? new Date().toISOString() : null,
    })
    .select('id')
    .single();
  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });

  if (opening.assistantMessages.length > 0) {
    const { error: msgError } = await supabase.from('calldesk_chat_messages').insert(
      opening.assistantMessages.map((content) => ({
        session_id: session.id,
        role: 'assistant' as const,
        content,
      }))
    );
    if (msgError) return NextResponse.json({ error: msgError.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      sessionId: session.id,
      businessName: tenant.name,
      messages: opening.assistantMessages.map((content) => ({ role: 'assistant', content })),
      ended: opening.ended,
    },
    { status: 201 }
  );
}
