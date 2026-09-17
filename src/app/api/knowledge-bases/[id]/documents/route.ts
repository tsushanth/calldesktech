import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';
import { scrapeUrl, chunkPlainText } from '@/lib/scraper';

// Adds ONE document (a web page or a block of pasted text) to an EXISTING
// knowledge base — the piece that makes a KB able to accumulate multiple
// sources over time, matching Retell's own "+ Add" flow (one KB, several
// independently-added documents) instead of the old one-source-per-KB
// model. See migration 014_knowledge_base_documents.sql.
//
// Same engine gate as KB creation (tenants/[id]/knowledge-bases/route.ts):
// a 'poc'-engine tenant's documents are scraped/chunked by us and stored
// directly; only a 'retell'-engine tenant's documents go through Retell's
// (paid, per-KB) API, since Retell is already answering that tenant's
// calls either way.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: knowledgeBaseId } = await params;
  const supabase = getSupabaseAdmin();
  const body = await request.json();
  const { type, sourceUrl, text, title } = body as {
    type: 'website' | 'text';
    sourceUrl?: string;
    text?: string;
    title?: string;
  };

  if (type === 'website' && !sourceUrl) {
    return NextResponse.json({ error: 'sourceUrl is required for a website document' }, { status: 400 });
  }
  if (type === 'text' && !text?.trim()) {
    return NextResponse.json({ error: 'text is required for a text document' }, { status: 400 });
  }

  const { data: kb, error: kbError } = await supabase
    .from('calldesk_knowledge_bases')
    .select('id, tenant_id, retell_kb_id, calldesk_tenants(settings)')
    .eq('id', knowledgeBaseId)
    .single();
  if (kbError || !kb) return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 });

  const tenantSettings = (kb as unknown as { calldesk_tenants: { settings?: { voice_engine?: string } } }).calldesk_tenants?.settings;
  const voiceEngine = tenantSettings?.voice_engine === 'retell' ? 'retell' : 'poc';

  // Row created up front as 'processing' so a slow scrape/Retell call is
  // visible in the Documents list rather than the document only appearing
  // once fully done — mirrors calldesk_knowledge_bases' own pending states
  // elsewhere in this codebase, not a new pattern.
  const { data: doc, error: docInsertError } = await supabase
    .from('calldesk_knowledge_documents')
    .insert({
      knowledge_base_id: knowledgeBaseId,
      type,
      source_url: type === 'website' ? sourceUrl : null,
      title: title || (type === 'website' ? sourceUrl : 'Pasted text'),
      status: 'processing',
    })
    .select()
    .single();
  if (docInsertError) return NextResponse.json({ error: docInsertError.message }, { status: 500 });

  try {
    let items: { question: string; answer: string }[] = [];

    if (voiceEngine === 'retell') {
      const retell = getRetellClient();
      if (kb.retell_kb_id) {
        // Existing Retell KB — extend it with this one new source, not a
        // second parallel KB, so Retell's own KB stays the single source
        // of truth for a retell-engine tenant's agent.
        await retell.updateKnowledgeBase(kb.retell_kb_id, type === 'website' ? { urls: [sourceUrl!] } : { texts: [text!] });
      } else {
        const created = await retell.createKnowledgeBase(
          type === 'website'
            ? { name: title || sourceUrl!, urls: [sourceUrl!] }
            : { name: title || 'Pasted text', texts: [{ title: title || 'Pasted text', text: text! }] }
        );
        await supabase.from('calldesk_knowledge_bases').update({ retell_kb_id: created.knowledge_base_id }).eq('id', knowledgeBaseId);
      }
      // Retell stores/serves the actual content on its side — we don't get
      // structured Q&A items back to mirror locally, only that it succeeded.
    } else {
      items = type === 'website' ? await scrapeUrl(sourceUrl!) : chunkPlainText(text!, title || 'Pasted text');
    }

    if (items.length > 0) {
      const { error: itemsError } = await supabase.from('calldesk_knowledge_items').insert(
        items.map((item) => ({ knowledge_base_id: knowledgeBaseId, document_id: doc.id, question: item.question, answer: item.answer }))
      );
      if (itemsError) throw itemsError;
    }

    const { data: updatedDoc, error: statusError } = await supabase
      .from('calldesk_knowledge_documents')
      .update({ status: 'ready' })
      .eq('id', doc.id)
      .select()
      .single();
    if (statusError) throw statusError;

    return NextResponse.json({ document: updatedDoc, itemCount: items.length }, { status: 201 });
  } catch (err) {
    console.error(`[knowledge-documents] failed to process document ${doc.id}:`, err);
    const message = err instanceof Error ? err.message : 'Failed to process document';
    await supabase.from('calldesk_knowledge_documents').update({ status: 'failed', error: message }).eq('id', doc.id);
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: knowledgeBaseId } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_knowledge_documents')
    .select('*')
    .eq('knowledge_base_id', knowledgeBaseId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ documents: data || [] });
}
