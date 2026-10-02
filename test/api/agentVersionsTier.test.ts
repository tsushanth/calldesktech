import { it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/authz', () => ({ authorizeResource: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/lib/stripe', () => ({ syncVoicePriceForTenant: vi.fn().mockResolvedValue(undefined) }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { syncVoicePriceForTenant } from '@/lib/stripe';
import { POST } from '@/app/api/agents/[id]/versions/route';

let inserted: Record<string, unknown> | null;

function supabaseMock() {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {};
      let op = '';
      for (const m of ['select', 'eq', 'order', 'limit', 'in']) b[m] = () => b;
      b.insert = (row: Record<string, unknown>) => { op = 'insert'; if (table === 'calldesk_agent_versions') inserted = row; return b; };
      const result = () => {
        if (table === 'calldesk_agents') return { data: { tenant_id: 't1' }, error: null };
        if (table === 'calldesk_conversation_flows') return { data: { id: 'flow1' }, error: null };
        if (table === 'calldesk_agent_versions' && op === 'insert') return { data: { id: 'v1', ...inserted }, error: null };
        return { data: null, error: null };
      };
      b.single = async () => result();
      b.maybeSingle = async () => result();
      return b;
    },
  };
}

const nodes = [{ id: 'greet', type: 'greeting', prompt: 'hi', edges: [] }];
function post(extra: Record<string, unknown>) {
  const req = new NextRequest('https://example.com/api/agents/a1/versions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ flowName: 'v1', startNodeId: 'greet', nodes, voiceEngine: 'poc', ...extra }),
  });
  return POST(req, { params: Promise.resolve({ id: 'a1' }) });
}

beforeEach(() => {
  inserted = null;
  vi.mocked(getSupabaseAdmin).mockReturnValue(supabaseMock() as never);
  vi.mocked(syncVoicePriceForTenant).mockClear();
});

it('without a tier nothing changes: no tier columns written, voice price synced as before', async () => {
  const res = await post({ ttsBackend: 'elevenlabs', ttsModel: 'eleven_flash_v2_5' });
  expect(res.status).toBe(201);
  expect(inserted).toMatchObject({ tts_backend: 'elevenlabs', tts_model: 'eleven_flash_v2_5', llm_model: null });
  expect(inserted).not.toHaveProperty('tier');
  expect(inserted).not.toHaveProperty('tier_overrides');
  expect(syncVoicePriceForTenant).toHaveBeenCalledWith('t1', 'elevenlabs');
});

it('tier standard derives the models, records the tier, and leaves the subscription voice price alone', async () => {
  const res = await post({ tier: 'standard' });
  expect(res.status).toBe(201);
  expect(inserted).toMatchObject({ tier: 'standard', tier_overrides: null, llm_model: 'claude-haiku-4-5-20251001', tts_backend: 'elevenlabs', tts_model: 'eleven_flash_v2_5' });
  expect(syncVoicePriceForTenant).not.toHaveBeenCalled();
});

it('explicit overrides win and are recorded', async () => {
  const res = await post({ tier: 'pro', llmModel: 'claude-sonnet-4-6' });
  expect(res.status).toBe(201);
  expect(inserted).toMatchObject({ tier: 'pro', llm_model: 'claude-sonnet-4-6', tts_model: 'eleven_v4_turbo', tier_overrides: ['llmModel'] });
});

it('a non-English language still pins a voice backend with a tier', async () => {
  const res = await post({ tier: 'standard', globalSettings: { language: 'es' } });
  expect(res.status).toBe(201);
  expect(inserted).toMatchObject({ tts_backend: 'elevenlabs', tier: 'standard' });
});

it('rejects lite with a 400 coming-soon message and writes nothing', async () => {
  const res = await post({ tier: 'lite' });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/coming soon/i);
  expect(inserted).toBeNull();
});

it('rejects an unknown tier, a tier on retell, and an invalid override', async () => {
  const unknown = await post({ tier: 'storm' });
  expect(unknown.status).toBe(400);
  expect((await unknown.json()).error).toMatch(/Unknown tier/);
  const retell = await post({ tier: 'pro', voiceEngine: 'retell' });
  expect(retell.status).toBe(400);
  const badModel = await post({ tier: 'standard', llmModel: 'not-a-model' });
  expect(badModel.status).toBe(400);
  expect((await badModel.json()).error).toMatch(/Unknown llmModel/);
  expect(inserted).toBeNull();
});
