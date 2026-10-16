import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { buildDemoLinkConfig, DEMO_SLUG, isLinkLive, type DemoLinkRow } from '@/lib/demoLinks';

// GET /api/demo-links/[slug]: the setup for a demo link, for the /talk/[slug] page. Public by design (the slug is the secret),
// so: unknown, disabled and expired links are all the same 404, and the response carries only the flow, voice and time cap.
// A light per-IP limit stops scraping slugs.
const hits = new Map<string, number[]>();
function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return true; }
  recent.push(now); hits.set(key, recent);
  return false;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  if (limited(`ip:${ip}`, 40, 3600_000)) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  const notFound = () => NextResponse.json({ error: 'This demo link is not available' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!DEMO_SLUG.test(slug)) return notFound();

  const db = getSupabaseAdmin();
  const { data: link } = await db.from('calldesk_demo_links').select('slug, label, max_seconds, expires_at, enabled, agent_version_id').eq('slug', slug).maybeSingle();
  if (!link || !isLinkLive(link as DemoLinkRow)) return notFound();

  const { data: version } = await db.from('calldesk_agent_versions').select('tts_backend, tts_model, voice_id, llm_model, flow_id').eq('id', (link as { agent_version_id: string }).agent_version_id).maybeSingle();
  if (!version?.flow_id) return notFound();
  const { data: flow } = await db.from('calldesk_conversation_flows').select('nodes, global_settings').eq('id', version.flow_id).maybeSingle();
  if (!flow) return notFound();

  const config = buildDemoLinkConfig(link as DemoLinkRow, version, flow);
  if (!config) return notFound();
  return NextResponse.json(config, { headers: { 'Cache-Control': 'no-store' } });
}
