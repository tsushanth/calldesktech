import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// GET/POST calldesk_knowledge_items for one knowledge base — see
// tenants/[id]/knowledge-bases/route.ts for why this exists (RLS silently
// blocked the direct client-side equivalent).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: knowledgeBaseId } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_knowledge_items')
    .select('*')
    .eq('knowledge_base_id', knowledgeBaseId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: knowledgeBaseId } = await params;
  const supabase = getSupabaseAdmin();
  const { items } = await request.json();
  const { data, error } = await supabase
    .from('calldesk_knowledge_items')
    .insert(items.map((item: { question: string; answer: string }) => ({ ...item, knowledge_base_id: knowledgeBaseId })))
    .select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [] }, { status: 201 });
}
