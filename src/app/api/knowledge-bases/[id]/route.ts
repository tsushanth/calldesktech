import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';

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
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
