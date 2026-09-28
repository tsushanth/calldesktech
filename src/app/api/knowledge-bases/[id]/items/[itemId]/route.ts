import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeResource } from '@/lib/authz';

// DELETE /api/knowledge-bases/[id]/items/[itemId]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const __auth = await authorizeResource(request, 'calldesk_knowledge_bases', id);
  if (!__auth.ok) return __auth.response;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('calldesk_knowledge_items')
    .delete()
    .eq('id', itemId)
    .eq('knowledge_base_id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// GET /api/knowledge-bases/[id]/items/[itemId] — single knowledge item
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const __auth = await authorizeResource(request, 'calldesk_knowledge_bases', id);
  if (!__auth.ok) return __auth.response;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_knowledge_items')
    .select('*')
    .eq('id', itemId)
    .eq('knowledge_base_id', id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}
