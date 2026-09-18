import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';
import { scrapeUrl, chunkPlainText } from '@/lib/scraper';
import { extractPdfText } from '@/lib/pdfParser';
import { authorizeResource } from '@/lib/authz';

const MAX_PDF_BYTES = 25 * 1024 * 1024; // matches the 'knowledge-base-files' bucket's own file_size_limit

// Adds ONE document (a web page, a block of pasted text, or an uploaded
// PDF) to an EXISTING knowledge base — the piece that makes a KB able to
// accumulate multiple sources over time, matching Retell's own "+ Add"
// flow (one KB, several independently-added documents) instead of the old
// one-source-per-KB model. See migrations 014/015.
//
// Same engine gate as KB creation (tenants/[id]/knowledge-bases/route.ts):
// a 'poc'-engine tenant's documents are scraped/chunked/parsed by us and
// stored directly; only a 'retell'-engine tenant's documents go through
// Retell's (paid, per-KB) API, since Retell is already answering that
// tenant's calls either way.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_knowledge_bases', (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: knowledgeBaseId } = await params;
  const supabase = getSupabaseAdmin();

  let type: 'website' | 'text' | 'pdf';
  let sourceUrl: string | undefined;
  let text: string | undefined;
  let title: string | undefined;
  let pdfBuffer: Buffer | undefined;
  let pdfFilename: string | undefined;

  // A PDF upload arrives as multipart/form-data (a real binary file);
  // website/text documents still come in as plain JSON — branch on
  // content-type rather than forcing every caller through FormData.
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    type = 'pdf';
    title = (formData.get('title') as string) || undefined;
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file is required for a pdf document' }, { status: 400 });
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: `File exceeds the ${MAX_PDF_BYTES / 1024 / 1024}MB limit` }, { status: 400 });
    }
    pdfBuffer = Buffer.from(await file.arrayBuffer());
    pdfFilename = file.name;
  } else {
    const body = await request.json();
    ({ type, sourceUrl, text, title } = body as { type: 'website' | 'text'; sourceUrl?: string; text?: string; title?: string });
  }

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

  const defaultTitle = type === 'website' ? sourceUrl : type === 'pdf' ? pdfFilename : 'Pasted text';

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
      title: title || defaultTitle,
      status: 'processing',
    })
    .select()
    .single();
  if (docInsertError) return NextResponse.json({ error: docInsertError.message }, { status: 500 });

  try {
    let items: { question: string; answer: string }[] = [];
    let storagePath: string | undefined;

    // A PDF has no Retell-API equivalent that accepts a raw file upload,
    // so its text is always extracted locally first regardless of engine —
    // only WHERE that extracted text ends up (our own items table vs.
    // Retell's KB) still follows the engine gate below.
    if (type === 'pdf') {
      items = await extractPdfText(pdfBuffer!, title || pdfFilename || 'Uploaded PDF');
      storagePath = `${knowledgeBaseId}/${doc.id}-${pdfFilename}`;
      const { error: uploadError } = await supabase.storage
        .from('knowledge-base-files')
        .upload(storagePath, pdfBuffer!, { contentType: 'application/pdf' });
      if (uploadError) {
        // Keep the extracted text either way — losing the searchable
        // content over a storage hiccup (the original file is a
        // reference copy, not the primary data) would be the wrong
        // failure mode here.
        console.error(`[knowledge-documents] PDF uploaded to storage failed for doc ${doc.id}:`, uploadError);
        storagePath = undefined;
      }
    }

    if (voiceEngine === 'retell') {
      const retell = getRetellClient();
      const retellTexts =
        type === 'pdf'
          ? [{ title: title || pdfFilename || 'Uploaded PDF', text: items.map((i) => `${i.question}\n${i.answer}`).join('\n\n') }]
          : type === 'text'
            ? [{ title: title || 'Pasted text', text: text! }]
            : undefined;
      if (kb.retell_kb_id) {
        // Existing Retell KB — extend it with this one new source, not a
        // second parallel KB, so Retell's own KB stays the single source
        // of truth for a retell-engine tenant's agent.
        await retell.updateKnowledgeBase(
          kb.retell_kb_id,
          type === 'website' ? { urls: [sourceUrl!] } : { texts: retellTexts!.map((t) => t.text) }
        );
      } else {
        const created = await retell.createKnowledgeBase(
          type === 'website' ? { name: title || sourceUrl!, urls: [sourceUrl!] } : { name: title || 'Pasted text', texts: retellTexts }
        );
        await supabase.from('calldesk_knowledge_bases').update({ retell_kb_id: created.knowledge_base_id }).eq('id', knowledgeBaseId);
      }
      // Retell stores/serves the actual content on its side for
      // website/text — we don't get structured Q&A items back to mirror
      // locally, only that it succeeded. A PDF's items were already
      // extracted above regardless, so those still get stored locally too
      // (below) even for a retell-engine tenant, so the original text
      // stays inspectable in our own UI either way.
      if (type !== 'pdf') items = [];
    } else if (type !== 'pdf') {
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
      .update({ status: 'ready', ...(storagePath ? { storage_path: storagePath } : {}) })
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
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_knowledge_bases', (await params).id);
  if (!__auth.ok) return __auth.response;

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
