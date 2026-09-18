import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';
import { authorizeResource, belongsToTenant } from '@/lib/authz';

// Attaches (or re-attaches) this KB to an agent — required for a
// knowledge_base node to ever see its content (see the agent_id comment in
// tenants/[id]/knowledge-bases/route.ts's POST). Also the only way an
// existing, already-created KB can be bound after the fact, since the
// dashboard's Knowledge page has no agent picker yet.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_knowledge_bases', (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: knowledgeBaseId } = await params;
  const supabase = getSupabaseAdmin();
  const body = await request.json();
  const updates: Record<string, unknown> = {};
  if (body.agent_id && __auth.tenantId && !(await belongsToTenant('calldesk_agents', body.agent_id, __auth.tenantId))) {
    return NextResponse.json({ error: 'agent_id not found' }, { status: 404 });
  }
  if ('agent_id' in body) updates.agent_id = body.agent_id || null;
  if (body.name !== undefined) updates.name = body.name;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('calldesk_knowledge_bases')
    .update(updates)
    .eq('id', knowledgeBaseId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ knowledgeBase: data });
}

// DELETE a knowledge base. calldesk_knowledge_items has ON DELETE CASCADE
// on knowledge_base_id (see supabase/migrations/004_...), so deleting the
// row here also removes its items — no separate items cleanup needed.
//
// If this KB has a retell_kb_id (created for a 'retell'-engine tenant —
// see tenants/[id]/knowledge-bases/route.ts's engine gate), also delete it
// on Retell's side. Skipping that would leave an orphaned KB still
// billing there ($8/KB/month past the free tier) with nothing in our own
// UI pointing at it to ever notice.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_knowledge_bases', (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: knowledgeBaseId } = await params;
  const supabase = getSupabaseAdmin();

  const { data: kb, error: fetchError } = await supabase
    .from('calldesk_knowledge_bases')
    .select('retell_kb_id')
    .eq('id', knowledgeBaseId)
    .single();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });

  if (kb?.retell_kb_id) {
    try {
      const retell = getRetellClient();
      await retell.deleteKnowledgeBase(kb.retell_kb_id);
    } catch (err) {
      // Don't block deleting our own record on Retell's API failing (e.g.
      // already deleted there manually) — log it so an orphan can still be
      // found and cleaned up, but the user's delete action should succeed.
      console.error(`[knowledge-bases] failed to delete Retell KB ${kb.retell_kb_id}:`, err);
    }
  }

  const { error } = await supabase.from('calldesk_knowledge_bases').delete().eq('id', knowledgeBaseId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
