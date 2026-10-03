import { it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/authz', () => ({ authorizeResource: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/lib/stripe', () => ({
  syncVoicePriceForTenant: vi.fn().mockResolvedValue(undefined),
  ensureTierItemForTenant: vi.fn().mockResolvedValue({ status: 'added', itemId: 'si_1' }),
}));

import { getSupabaseAdmin } from '@/lib/supabase';
import { syncVoicePriceForTenant, ensureTierItemForTenant } from '@/lib/stripe';
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
  vi.mocked(ensureTierItemForTenant).mockReset().mockResolvedValue({ status: 'added', itemId: 'si_1' });
  process.env.STRIPE_TIER_STANDARD_PRICE = 'price_test_standard';
  process.env.STRIPE_TIER_PRO_PRICE = 'price_test_pro';
  delete process.env.STRIPE_TIER_LITE_PRICE;
});

it('without a tier nothing changes: no tier columns written, voice price synced as before', async () => {
  const res = await post({ ttsBackend: 'elevenlabs', ttsModel: 'eleven_flash_v2_5' });
  expect(res.status).toBe(201);
  expect(inserted).toMatchObject({ tts_backend: 'elevenlabs', tts_model: 'eleven_flash_v2_5', llm_model: null });
  expect(inserted).not.toHaveProperty('tier');
  expect(inserted).not.toHaveProperty('tier_overrides');
  expect(syncVoicePriceForTenant).toHaveBeenCalledWith('t1', 'elevenlabs');
  expect(ensureTierItemForTenant).not.toHaveBeenCalled();
});

it('tier standard derives the models, records the tier, and leaves the subscription voice price alone', async () => {
  const res = await post({ tier: 'standard' });
  expect(res.status).toBe(201);
  expect(inserted).toMatchObject({ tier: 'standard', tier_overrides: null, llm_model: 'claude-haiku-4-5-20251001', tts_backend: 'elevenlabs', tts_model: 'eleven_flash_v2_5' });
  expect(syncVoicePriceForTenant).not.toHaveBeenCalled();
  expect(ensureTierItemForTenant).toHaveBeenCalledWith('t1', 'standard');
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

it('rejects lite without acceptLowerQuality with a 400 and writes nothing', async () => {
  const res = await post({ tier: 'lite' });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/acceptLowerQuality/);
  expect(inserted).toBeNull();
});

it('publishes lite on piper once the quality tradeoff is accepted', async () => {
  process.env.STRIPE_TIER_LITE_PRICE = 'price_lite';
  const res = await post({ tier: 'lite', acceptLowerQuality: true });
  expect(res.status).toBe(201);
  expect(inserted).toMatchObject({ tier: 'lite', tts_backend: 'piper' });
  delete process.env.STRIPE_TIER_LITE_PRICE;
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

it('a tiered publish whose price env var is not set is refused with 503 and writes nothing', async () => {
  delete process.env.STRIPE_TIER_STANDARD_PRICE;
  const res = await post({ tier: 'standard' });
  expect(res.status).toBe(503);
  const body = await res.json();
  expect(body.error).toMatch(/not yet available/i);
  expect(body.code).toBe('tier_billing_not_configured');
  expect(inserted).toBeNull();
  expect(ensureTierItemForTenant).not.toHaveBeenCalled();
  expect(syncVoicePriceForTenant).not.toHaveBeenCalled();
});

it('a blank price env var counts as not configured', async () => {
  process.env.STRIPE_TIER_PRO_PRICE = '   ';
  const res = await post({ tier: 'pro' });
  expect(res.status).toBe(503);
  expect(inserted).toBeNull();
});

it('a Stripe failure returns an explicit retryable 502, saves no version, and a retry succeeds', async () => {
  vi.mocked(ensureTierItemForTenant).mockRejectedValueOnce(new Error('stripe is down'));
  const failed = await post({ tier: 'standard' });
  expect(failed.status).toBe(502);
  const body = await failed.json();
  expect(body).toMatchObject({ code: 'tier_billing_failed', retryable: true });
  expect(body.error).toMatch(/nothing was saved/i);
  expect(inserted).toBeNull();
  expect(syncVoicePriceForTenant).not.toHaveBeenCalled();

  const retry = await post({ tier: 'standard' });
  expect(retry.status).toBe(201);
  expect(inserted).toMatchObject({ tier: 'standard' });
  expect(ensureTierItemForTenant).toHaveBeenCalledTimes(2);
});

it('a tenant with no subscription still publishes (same as the voice sync)', async () => {
  vi.mocked(ensureTierItemForTenant).mockResolvedValueOnce({ status: 'no_subscription' });
  const res = await post({ tier: 'pro' });
  expect(res.status).toBe(201);
  expect(inserted).toMatchObject({ tier: 'pro' });
});

it('legacy publishes never need tier billing, even with every tier price unset', async () => {
  delete process.env.STRIPE_TIER_STANDARD_PRICE;
  delete process.env.STRIPE_TIER_PRO_PRICE;
  const res = await post({ ttsBackend: 'cartesia' });
  expect(res.status).toBe(201);
  expect(ensureTierItemForTenant).not.toHaveBeenCalled();
  expect(syncVoicePriceForTenant).toHaveBeenCalledWith('t1', 'cartesia');
});

it('lite without acceptance is rejected before any billing check', async () => {
  const res = await post({ tier: 'lite' });
  expect(res.status).toBe(400);
  expect(ensureTierItemForTenant).not.toHaveBeenCalled();
});

it('tierOverrides from a restored version replace the derived ones (the stack may have changed since)', async () => {
  const res = await post({ tier: 'pro', llmModel: 'claude-sonnet-4-6', ttsModel: 'eleven_flash_v2_5', ttsBackend: 'elevenlabs', tierOverrides: ['llmModel', 'bogus', 7] });
  expect(res.status).toBe(201);
  // derived overrides would be [llmModel, ttsModel]; the caller's (filtered to known names) win
  expect(inserted).toMatchObject({ tier: 'pro', llm_model: 'claude-sonnet-4-6', tts_model: 'eleven_flash_v2_5', tier_overrides: ['llmModel'] });
});

it('tierOverrides are ignored without a tier', async () => {
  const res = await post({ tierOverrides: ['llmModel'] });
  expect(res.status).toBe(201);
  expect(inserted).not.toHaveProperty('tier_overrides');
});
