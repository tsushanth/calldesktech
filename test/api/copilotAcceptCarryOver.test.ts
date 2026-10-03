import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/authz', () => ({ authorizeResource: vi.fn().mockResolvedValue({ ok: true }) }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { PATCH } from '@/app/api/agents/[id]/copilot/suggestions/[suggestionId]/route';

let latest: Record<string, unknown>;

function supabaseMock() {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit', 'update']) b[m] = () => b;
      b.single = async () => {
        if (table === 'calldesk_agent_copilot_suggestions') return { data: { id: 's1', status: 'pending', node_id: 'greet', suggested_text: 'new text', version_id: 'v0' }, error: null };
        if (table === 'calldesk_agent_versions') return { data: latest, error: null };
        if (table === 'calldesk_conversation_flows') return { data: { name: 'flow', nodes: [{ id: 'greet', type: 'greeting', prompt: 'old', edges: [] }], global_settings: { startNodeId: 'greet' } }, error: null };
        return { data: { id: 's1', status: 'accepted' }, error: null };
      };
      return b;
    },
  };
}

let sent: Record<string, unknown> | null;
const realFetch = globalThis.fetch;
beforeEach(() => {
  sent = null;
  vi.mocked(getSupabaseAdmin).mockReturnValue(supabaseMock() as never);
  globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ version: { id: 'v2' } }), { status: 201 });
  }) as never;
});
afterEach(() => { globalThis.fetch = realFetch; });

function accept() {
  const req = new NextRequest('https://example.com/x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'accept' }) });
  return PATCH(req, { params: Promise.resolve({ id: 'a1', suggestionId: 's1' }) });
}

it('accepting a suggestion carries models, tier, tier_overrides, voice and backend to the new version', async () => {
  latest = { id: 'v1', flow_id: 'f1', voice_engine: 'poc', voice_id: 'voice-9', tts_backend: 'elevenlabs', llm_model: 'claude-sonnet-4-6', tts_model: 'eleven_v4_turbo', tier: 'pro', tier_overrides: ['llmModel'], retell_agent_id: null, retell_llm_id: null, wizard_config: null };
  const res = await accept();
  expect(res.status).toBe(200);
  expect(sent).toMatchObject({ voiceId: 'voice-9', ttsBackend: 'elevenlabs', llmModel: 'claude-sonnet-4-6', ttsModel: 'eleven_v4_turbo', tier: 'pro', tierOverrides: ['llmModel'] });
});

it('a model that is no longer in the catalog does not break the accept', async () => {
  latest = { id: 'v1', flow_id: 'f1', voice_engine: 'poc', voice_id: null, tts_backend: 'elevenlabs', llm_model: 'gemini-2.5-flash-lite', tts_model: null, tier: null, tier_overrides: null, retell_agent_id: null, retell_llm_id: null, wizard_config: null };
  const res = await accept();
  expect(res.status).toBe(200);
  expect(sent).not.toHaveProperty('llmModel');
});
