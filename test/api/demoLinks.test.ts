import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown> | null;
const rows: Record<string, Row> = {};
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (t: string) => {
      const b: Record<string, unknown> = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: rows[t] ?? null }) };
      return b;
    },
  }),
}));
import { GET } from '@/app/api/demo-links/[slug]/route';

const SLUG = 'abcdEFGH12345678abcd';
const get = (slug: string, ip = '1.1.1.1') => GET(new NextRequest(`https://calldesk.tech/api/demo-links/${slug}`, { headers: { 'x-forwarded-for': ip } }), { params: Promise.resolve({ slug }) });
const future = () => new Date(Date.now() + 86_400_000).toISOString();

beforeEach(() => {
  rows.calldesk_demo_links = { slug: SLUG, label: 'Demo line', max_seconds: 300, expires_at: future(), enabled: true, agent_version_id: 'v1' };
  rows.calldesk_agent_versions = { tts_backend: 'elevenlabs', tts_model: 'eleven_flash_v2_5', voice_id: 'voice1', llm_model: 'gemini-3.1-flash-lite', flow_id: 'f1' };
  rows.calldesk_conversation_flows = { nodes: [{ id: 'opening', type: 'greeting', prompt: 'hi' }], global_settings: { startNodeId: 'opening' } };
});

describe('GET /api/demo-links/[slug]', () => {
  it('returns the flow, voice and time cap, uncached, with nothing that identifies a workspace', async () => {
    const r = await get(SLUG);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const body = await r.json();
    expect(body).toMatchObject({ label: 'Demo line', maxSeconds: 300, flow: { startNodeId: 'opening' }, context: { voiceId: 'voice1', ttsBackend: 'elevenlabs' } });
    expect(JSON.stringify(body)).not.toMatch(/tenant|agent_version|slug/i);
  });
  it('404 for a malformed slug without touching the database', async () => {
    rows.calldesk_demo_links = null;
    expect((await get('short')).status).toBe(404);
    expect((await get('../../../etc/passwd/aaaaaaaa')).status).toBe(404);
  });
  it('the same 404 for an unknown, disabled or expired link, so a slug cannot be probed', async () => {
    rows.calldesk_demo_links = null;
    const unknown = await (await get(SLUG, '2.2.2.2')).text();
    rows.calldesk_demo_links = { slug: SLUG, label: 'x', max_seconds: 300, expires_at: future(), enabled: false, agent_version_id: 'v1' };
    const disabled = await get(SLUG, '2.2.2.3');
    rows.calldesk_demo_links = { slug: SLUG, label: 'x', max_seconds: 300, expires_at: '2020-01-01T00:00:00Z', enabled: true, agent_version_id: 'v1' };
    const expired = await get(SLUG, '2.2.2.4');
    expect(disabled.status).toBe(404); expect(expired.status).toBe(404);
    expect(await disabled.text()).toBe(unknown);
    expect(await expired.text()).toBe(unknown);
  });
  it('404 when the agent behind the link has no version or no flow', async () => {
    rows.calldesk_agent_versions = null;
    expect((await get(SLUG, '3.3.3.1')).status).toBe(404);
    rows.calldesk_agent_versions = { tts_backend: null, tts_model: null, voice_id: null, llm_model: null, flow_id: 'f1' };
    rows.calldesk_conversation_flows = { nodes: [], global_settings: null };
    expect((await get(SLUG, '3.3.3.2')).status).toBe(404);
  });
  it('limits one address to 40 requests an hour', async () => {
    for (let i = 0; i < 40; i++) expect((await get(SLUG, '9.9.9.9')).status).toBe(200);
    expect((await get(SLUG, '9.9.9.9')).status).toBe(429);
  });
});
