import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import type { FlowNode } from '@/types';
import { authorizeResource } from '@/lib/authz';

// PATCH /api/agents/[id]/copilot/suggestions/[suggestionId] — resolve a
// single Copilot suggestion.
//   { action: 'dismiss' } — just marks it dismissed, nothing else touched.
//   { action: 'accept' } — writes the suggested text into that node's prompt
//     and publishes it as a NEW, immutable draft version via the existing
//     POST /api/agents/[id]/versions path (same route the flow-builder UI
//     itself uses to save) — this route never auto-routes any phone number
//     or environment to the new version, so it stays a draft until someone
//     explicitly promotes/routes it, same as any hand-edited flow save.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; suggestionId: string }> }
) {
  const { id: agentId, suggestionId } = await params;
  const __auth = await authorizeResource(request, 'calldesk_agents', agentId);
  if (!__auth.ok) return __auth.response;

  const { action } = await request.json();
  if (action !== 'accept' && action !== 'dismiss') {
    return NextResponse.json({ error: 'action must be "accept" or "dismiss"' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: suggestion, error: suggestionError } = await supabase
    .from('calldesk_agent_copilot_suggestions')
    .select('*')
    .eq('id', suggestionId)
    .eq('agent_id', agentId)
    .single();
  if (suggestionError || !suggestion) return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
  if (suggestion.status !== 'pending') {
    return NextResponse.json({ error: `Suggestion already ${suggestion.status}` }, { status: 400 });
  }

  if (action === 'dismiss') {
    const { data, error } = await supabase
      .from('calldesk_agent_copilot_suggestions')
      .update({ status: 'dismissed' })
      .eq('id', suggestionId)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ suggestion: data });
  }

  // action === 'accept'
  const { data: latestVersion, error: versionError } = await supabase
    .from('calldesk_agent_versions')
    .select('*')
    .eq('agent_id', agentId)
    .order('version_number', { ascending: false })
    .limit(1)
    .single();
  if (versionError || !latestVersion) return NextResponse.json({ error: 'Agent has no version to base this edit on' }, { status: 400 });

  const { data: flow, error: flowError } = await supabase
    .from('calldesk_conversation_flows')
    .select('*')
    .eq('id', latestVersion.flow_id)
    .single();
  if (flowError || !flow) return NextResponse.json({ error: 'Flow not found' }, { status: 404 });

  const nodes = (flow.nodes || []) as FlowNode[];
  if (!nodes.some((n) => n.id === suggestion.node_id)) {
    return NextResponse.json({ error: 'Target node no longer exists in the latest flow' }, { status: 409 });
  }
  const updatedNodes = nodes.map((n) => (n.id === suggestion.node_id ? { ...n, prompt: suggestion.suggested_text } : n));

  try {
    // Self-fetch the existing draft-version create path (same as this app's
    // sync-retell route does for phone-number routing). Uses the in-container
    // localhost address rather than the public origin — a server-to-itself
    // request via the public hostname can get blocked by the edge proxy/NAT
    // in this environment ("fetch failed" with no further detail).
    const internalBase = `http://127.0.0.1:${process.env.PORT || 3000}`;
    const res = await fetch(`${internalBase}/api/agents/${agentId}/versions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: request.headers.get('cookie') || '',
        authorization: request.headers.get('authorization') || '',
      },
      body: JSON.stringify({
        flowName: flow.name,
        startNodeId: (flow.global_settings as { startNodeId?: string } | null)?.startNodeId,
        nodes: updatedNodes,
        globalSettings: flow.global_settings,
        voiceEngine: latestVersion.voice_engine,
        retellAgentId: latestVersion.retell_agent_id,
        retellLlmId: latestVersion.retell_llm_id,
        voiceId: latestVersion.voice_id,
        ttsBackend: latestVersion.tts_backend,
        wizardConfig: latestVersion.wizard_config,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: body.error || `versions route returned HTTP ${res.status}` }, { status: 500 });
    }

    const { data: updatedSuggestion, error: updateError } = await supabase
      .from('calldesk_agent_copilot_suggestions')
      .update({ status: 'accepted', version_id: body.version?.id ?? suggestion.version_id })
      .eq('id', suggestionId)
      .select()
      .single();
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    return NextResponse.json({ suggestion: updatedSuggestion, newVersion: body.version });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create draft version';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
