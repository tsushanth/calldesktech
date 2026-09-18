import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';
import { scrapeUrl } from '@/lib/scraper';
import { authorizeTenant, belongsToTenant } from '@/lib/authz';

// Simple CRUD against calldesk_knowledge_bases directly — deliberately
// separate from /api/tenants/[id]/knowledge, which does real Retell
// knowledge-base provisioning and has a different response shape. This one
// exists because src/lib/api.ts's getKnowledgeBases/createKnowledgeBase used
// to call calldesk_knowledge_bases directly from the browser with the anon
// key, which RLS silently blocks (see tenants/[id]/route.ts) — the
// dashboard's Knowledge page has never actually loaded data in production.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

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

// Real bug found 2026-09-16: this POST used to just insert whatever body it
// got (name/source_type/source_url) with no actual scraping — a 'website'
// source silently created an empty knowledge base with zero items, which is
// exactly what happened testing this against a real URL. Two things fixed
// here at once:
//
// 1. A 'website' source now actually gets scraped and turns into real
//    knowledge_items, instead of just recording a URL nothing ever reads.
// 2. Which scraper does the work is gated on the tenant's own voice_engine
//    (calldesk_tenants.settings.voice_engine, same field tenant creation
//    already branches on — see /api/tenants/route.ts's poc-vs-retell split)
//    rather than unconditionally calling Retell's API the way the *other*
//    knowledge route (/api/tenants/[id]/knowledge) does. A 'poc'-engine
//    tenant's calls never touch Retell at all; there's no reason its
//    knowledge base should either, and Retell's KB isn't free at scale
//    ($8/KB/month past the first 10, plus $0.005/min when queried) — that's
//    a real recurring cost to a direct competitor for functionality we can
//    just build ourselves. Only a 'retell'-engine tenant (where Retell is
//    already the thing answering the phone) delegates to Retell here.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();
  const body = await request.json();
  // Real bug found 2026-09-18: calldesk_knowledge_bases has an agent_id
  // column, and call-loop-poc's attachKnowledgeBaseIds REQUIRES it
  // (queries agent_id=eq.<agentId>) to resolve a knowledge_base node's
  // actual content at call time — but nothing in this route (or anywhere
  // else in the codebase) ever set it. Every knowledge_base node for every
  // poc-engine tenant has silently run with zero KB content since this
  // node type shipped; attachKnowledgeBaseIds' own fallback (no match ->
  // return nodes unchanged) meant this failed completely silently, no
  // error surfaced anywhere. agentId is optional here (a KB can still be
  // created unattached, e.g. from a future tenant-wide library view) but
  // must be set for any knowledge_base node to actually see its content.
  const { name, source_type: sourceType, source_url: sourceUrl, agent_id: agentId } = body;
  if (agentId && !(await belongsToTenant('calldesk_agents', agentId, tenantId))) {
    return NextResponse.json({ error: 'agent_id not found' }, { status: 404 });
  }

  const { data: tenant, error: tenantError } = await supabase
    .from('calldesk_tenants')
    .select('settings')
    .eq('id', tenantId)
    .single();
  if (tenantError) return NextResponse.json({ error: tenantError.message }, { status: 500 });
  // Default to 'poc' (no Retell call) when unset, not 'retell' — an
  // ambiguous engine should never silently start billing a competitor's API.
  const voiceEngine = tenant?.settings?.voice_engine === 'retell' ? 'retell' : 'poc';

  let retellKbId: string | null = null;
  let scrapedItems: { question: string; answer: string }[] = [];

  if (sourceType === 'website' && sourceUrl) {
    if (voiceEngine === 'retell') {
      const retell = getRetellClient();
      const kb = await retell.createKnowledgeBase({ name, urls: [sourceUrl] });
      retellKbId = kb.knowledge_base_id;
    } else {
      try {
        scrapedItems = await scrapeUrl(sourceUrl);
      } catch (err) {
        console.error(`[knowledge-bases] scrape failed for ${sourceUrl}:`, err);
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'Failed to scrape URL' },
          { status: 422 }
        );
      }
    }
  }

  const { data: knowledgeBase, error } = await supabase
    .from('calldesk_knowledge_bases')
    .insert({ name, source_type: sourceType, source_url: sourceUrl, retell_kb_id: retellKbId, tenant_id: tenantId, agent_id: agentId || null })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (scrapedItems.length > 0) {
    const { error: itemsError } = await supabase.from('calldesk_knowledge_items').insert(
      scrapedItems.map((item) => ({ knowledge_base_id: knowledgeBase.id, question: item.question, answer: item.answer }))
    );
    if (itemsError) {
      console.error(`[knowledge-bases] created KB ${knowledgeBase.id} but failed to insert scraped items:`, itemsError);
    }
  }

  return NextResponse.json({ knowledgeBase }, { status: 201 });
}
