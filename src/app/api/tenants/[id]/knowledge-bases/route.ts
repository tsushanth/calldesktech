import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Simple CRUD against calldesk_knowledge_bases directly — deliberately
// separate from /api/tenants/[id]/knowledge, which does real Retell
// knowledge-base provisioning and has a different response shape. This one
// exists because src/lib/api.ts's getKnowledgeBases/createKnowledgeBase used
// to call calldesk_knowledge_bases directly from the browser with the anon
// key, which RLS silently blocks (see tenants/[id]/route.ts) — the
// dashboard's Knowledge page has never actually loaded data in production.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_knowledge_bases')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ knowledgeBases: data || [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();
  const body = await request.json();
  const { data, error } = await supabase
    .from('calldesk_knowledge_bases')
    .insert({ ...body, tenant_id: tenantId })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ knowledgeBase: data }, { status: 201 });
}
