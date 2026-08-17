import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';

// GET /api/tenants/[id]/knowledge - Get knowledge bases for a tenant
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tenantId } = await params;
    const supabase = getSupabaseAdmin();

    const { data: knowledgeBases, error } = await supabase
      .from('calldesk_knowledge_bases')
      .select(`
        *,
        knowledge_items (*)
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json({ knowledgeBases });
  } catch (error) {
    console.error('Error fetching knowledge bases:', error);
    return NextResponse.json(
      { error: 'Failed to fetch knowledge bases' },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[id]/knowledge - Create a knowledge base
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tenantId } = await params;
    const supabase = getSupabaseAdmin();
    const retell = getRetellClient();
    const body = await request.json();

    const { name, sourceType, sourceUrl, items } = body;

    // Create knowledge base in Retell
    let retellKbId: string | null = null;

    if (sourceType === 'website' && sourceUrl) {
      // Scrape website
      const kb = await retell.createKnowledgeBase({
        name,
        urls: [sourceUrl],
      });
      retellKbId = kb.knowledge_base_id;
    } else if (sourceType === 'manual' && items?.length > 0) {
      // Create from Q&A pairs
      const texts = items.map(
        (item: { question: string; answer: string }) =>
          `Q: ${item.question}\nA: ${item.answer}`
      );
      const kb = await retell.createKnowledgeBase({
        name,
        texts,
      });
      retellKbId = kb.knowledge_base_id;
    }

    // Save to database
    const { data: knowledgeBase, error } = await supabase
      .from('calldesk_knowledge_bases')
      .insert({
        tenant_id: tenantId,
        name,
        source_type: sourceType,
        source_url: sourceUrl,
        retell_kb_id: retellKbId,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Save knowledge items if manual
    if (sourceType === 'manual' && items?.length > 0) {
      await supabase.from('calldesk_knowledge_items').insert(
        items.map((item: { question: string; answer: string }) => ({
          knowledge_base_id: knowledgeBase.id,
          question: item.question,
          answer: item.answer,
        }))
      );
    }

    // Update tenant with knowledge base ID
    if (retellKbId) {
      await supabase
        .from('calldesk_tenants')
        .update({ knowledge_base_id: retellKbId })
        .eq('id', tenantId);
    }

    return NextResponse.json({ knowledgeBase }, { status: 201 });
  } catch (error) {
    console.error('Error creating knowledge base:', error);
    return NextResponse.json(
      { error: 'Failed to create knowledge base' },
      { status: 500 }
    );
  }
}

// PUT /api/tenants/[id]/knowledge - Add items to knowledge base
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tenantId } = await params;
    const supabase = getSupabaseAdmin();
    const retell = getRetellClient();
    const body = await request.json();

    const { knowledgeBaseId, items } = body;

    // Get existing knowledge base
    const { data: kb, error: kbError } = await supabase
      .from('calldesk_knowledge_bases')
      .select('*')
      .eq('id', knowledgeBaseId)
      .eq('tenant_id', tenantId)
      .single();

    if (kbError || !kb) {
      return NextResponse.json(
        { error: 'Knowledge base not found' },
        { status: 404 }
      );
    }

    // Add items to database
    await supabase.from('calldesk_knowledge_items').insert(
      items.map((item: { question: string; answer: string }) => ({
        knowledge_base_id: knowledgeBaseId,
        question: item.question,
        answer: item.answer,
      }))
    );

    // Update Retell knowledge base
    if (kb.retell_kb_id) {
      const { data: allItems } = await supabase
        .from('calldesk_knowledge_items')
        .select('*')
        .eq('knowledge_base_id', knowledgeBaseId);

      const texts = (allItems || []).map(
        (item) => `Q: ${item.question}\nA: ${item.answer}`
      );

      await retell.updateKnowledgeBase(kb.retell_kb_id, { texts });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating knowledge base:', error);
    return NextResponse.json(
      { error: 'Failed to update knowledge base' },
      { status: 500 }
    );
  }
}
