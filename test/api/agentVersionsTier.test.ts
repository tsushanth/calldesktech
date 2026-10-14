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
  expect(inserted).toMatchObject({ tier: 'standard', tier_overrides: null, llm_model: 'gemini-3.1-flash-lite', tts_backend: 'elevenlabs', tts_model: 'eleven_flash_v2_5' });
  expect(syncVoicePriceForTenant).not.toHaveBeenCalled();
  expect(ensureTierItemForTenant).toHaveBeenCalledWith('t1', 'standard');
});

it('explicit overrides win and are recorded', async () => {
  const res = await post({ tier: 'pro', llmModel: 'claude-haiku-4-5-20251001' });
  expect(res.status).toBe(201);
  expect(inserted).toMatchObject({ tier: 'pro', llm_model: 'claude-haiku-4-5-20251001', tts_model: 'eleven_v4_turbo', tier_overrides: ['llmModel'] });
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
  expect(inserted).toMatchObject({ tier: 'lite', tts_backend: 'piper', voice_id: 'custom:en-us-warm-f' });
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

const LITE = { tier: 'lite', acceptLowerQuality: true };

it.each([
  ['es', 'custom:es-pilot-f'], ['de', 'custom:de-de-mls-f'], ['fr', 'custom:fr-fr-mls-f'], ['it', 'custom:it-it-serena'], ['pt-BR', 'custom:pt-br-faber'],
])('lite publishes %s on Piper with the language voice %s, billed as a tier (no voice price sync)', async (language, voice) => {
  process.env.STRIPE_TIER_LITE_PRICE = 'price_test_lite';
  const res = await post({ ...LITE, globalSettings: { language } });
  expect(res.status).toBe(201);
  expect(inserted).toMatchObject({ voice_id: voice, tts_backend: 'piper', tier: 'lite' });
  expect(ensureTierItemForTenant).toHaveBeenCalled();
  expect(syncVoicePriceForTenant).not.toHaveBeenCalled();
});

it('lite with the pt alias normalizes to pt-BR and its voice', async () => {
  process.env.STRIPE_TIER_LITE_PRICE = 'price_test_lite';
  for (const alias of ['pt', 'pt-br']) {
    const res = await post({ ...LITE, globalSettings: { language: alias } });
    expect(res.status).toBe(201);
    expect(inserted).toMatchObject({ voice_id: 'custom:pt-br-faber' });
  }
});

it.each(['nl', 'hi', 'ja', 'pl', 'ar'])('lite refuses %s (400, nothing written) and tells the caller which languages Lite covers', async (language) => {
  process.env.STRIPE_TIER_LITE_PRICE = 'price_test_lite';
  const res = await post({ ...LITE, globalSettings: { language } });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.code).toBe('language_not_supported_on_tier');
  expect(body.error).toMatch(/English, German, Spanish, French, Italian and Portuguese/);
  expect(body.error).toMatch(/Standard or Pro/);
  expect(inserted).toBeNull();
  expect(ensureTierItemForTenant).not.toHaveBeenCalled();
});

it('the refusal keeps the old code for compatibility', async () => {
  process.env.STRIPE_TIER_LITE_PRICE = 'price_test_lite';
  const body = await (await post({ ...LITE, globalSettings: { language: 'nl' } })).json();
  expect(body.code).toBe('language_not_supported_on_tier');
  expect(body.legacy_code).toBe('language_needs_multilingual_voice');
});

it('lite in English keeps the English voice exactly as before', async () => {
  process.env.STRIPE_TIER_LITE_PRICE = 'price_test_lite';
  for (const gs of [undefined, { language: 'en' }, { language: 'en-US' }]) {
    const res = await post({ ...LITE, ...(gs ? { globalSettings: gs } : {}) });
    expect(res.status).toBe(201);
    expect(inserted).toMatchObject({ voice_id: 'custom:en-us-warm-f', tts_backend: 'piper', tier: 'lite' });
  }
});

it('lite keeps a caller voiceId that belongs to the language (the alternate voice)', async () => {
  process.env.STRIPE_TIER_LITE_PRICE = 'price_test_lite';
  const res = await post({ ...LITE, voiceId: 'custom:de-de-mls-m', globalSettings: { language: 'de' } });
  expect(res.status).toBe(201);
  expect(inserted).toMatchObject({ voice_id: 'custom:de-de-mls-m' });
});

it('a Piper voiceId from another language is refused with voice_language_mismatch (nothing written)', async () => {
  process.env.STRIPE_TIER_LITE_PRICE = 'price_test_lite';
  let res = await post({ ...LITE, voiceId: 'custom:en-us-warm-f', globalSettings: { language: 'es' } });
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe('voice_language_mismatch');
  expect(inserted).toBeNull();
  res = await post({ ...LITE, voiceId: 'custom:fr-fr-mls-f', globalSettings: { language: 'de' } });
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe('voice_language_mismatch');
  res = await post({ ...LITE, voiceId: 'custom:es-pilot-f' });
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe('voice_language_mismatch');
  expect(inserted).toBeNull();
});

it('lite stamps the language voice when the caller sent a voiceId that is not a Piper voice', async () => {
  process.env.STRIPE_TIER_LITE_PRICE = 'price_test_lite';
  const res = await post({ ...LITE, voiceId: 'some-elevenlabs-id', globalSettings: { language: 'it' } });
  expect(res.status).toBe(201);
  expect(inserted).toMatchObject({ voice_id: 'custom:it-it-serena' });
});

it('lite validates switchableLanguages: every code must be English or Piper-covered', async () => {
  process.env.STRIPE_TIER_LITE_PRICE = 'price_test_lite';
  let res = await post({ ...LITE, globalSettings: { allowLanguageSwitching: true, switchableLanguages: ['es', 'de', 'pt', 'en'] } });
  expect(res.status).toBe(201);
  res = await post({ ...LITE, globalSettings: { allowLanguageSwitching: true, switchableLanguages: ['es', 'nl'] } });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.code).toBe('language_not_supported_on_tier');
  expect(body.error).toMatch(/Dutch|nl/);
  res = await post({ ...LITE, globalSettings: { language: 'es', switchableLanguages: ['xx'] } });
  expect(res.status).toBe(400);
});

it('switchableLanguages stay unvalidated on Standard and Pro', async () => {
  expect((await post({ tier: 'standard', globalSettings: { allowLanguageSwitching: true, switchableLanguages: ['nl', 'ja'] } })).status).toBe(201);
  expect((await post({ tier: 'pro', globalSettings: { switchableLanguages: ['nl'] } })).status).toBe(201);
});

it('lite in English still publishes, and standard and pro keep accepting other languages', async () => {
  process.env.STRIPE_TIER_LITE_PRICE = 'price_test_lite';
  expect((await post({ tier: 'lite', acceptLowerQuality: true, globalSettings: { language: 'en' } })).status).toBe(201);
  expect((await post({ tier: 'standard', globalSettings: { language: 'fr' } })).status).toBe(201);
  expect((await post({ tier: 'pro', globalSettings: { language: 'de' } })).status).toBe(201);
});

it('choosing the Piper voice directly: a covered language is allowed with the language voice (legacy path still syncs the voice price)', async () => {
  const res = await post({ ttsBackend: 'piper', globalSettings: { language: 'es' } });
  expect(res.status).toBe(201);
  expect(inserted).toMatchObject({ tts_backend: 'piper', voice_id: 'custom:es-pilot-f' });
  expect(syncVoicePriceForTenant).toHaveBeenCalled();
});

it('choosing the Piper voice directly with an uncovered language is refused', async () => {
  const res = await post({ ttsBackend: 'piper', globalSettings: { language: 'nl' } });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.code).toBe('language_not_supported_on_tier');
  expect(body.legacy_code).toBe('language_needs_multilingual_voice');
  expect(body.error).toMatch(/English, German, Spanish, French, Italian and Portuguese/);
  expect(inserted).toBeNull();
});

it('Piper chosen directly rejects a voiceId from another language, and validates switchableLanguages', async () => {
  let res = await post({ ttsBackend: 'piper', voiceId: 'custom:de-de-mls-f', globalSettings: { language: 'fr' } });
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe('voice_language_mismatch');
  res = await post({ ttsBackend: 'piper', globalSettings: { switchableLanguages: ['nl'] } });
  expect(res.status).toBe(400);
});

it('without a tier or Piper, non-English still pins elevenlabs exactly as before', async () => {
  const res = await post({ globalSettings: { language: 'nl' } });
  expect(res.status).toBe(201);
  expect(inserted).toMatchObject({ tts_backend: 'elevenlabs' });
});

it('lite with a voice-backend override still refuses an uncovered language (the plan decides, as before), and keeps covered ones on that backend', async () => {
  process.env.STRIPE_TIER_LITE_PRICE = 'price_test_lite';
  const refused = await post({ ...LITE, ttsBackend: 'elevenlabs', ttsModel: 'eleven_flash_v2_5', globalSettings: { language: 'nl' } });
  expect(refused.status).toBe(400);
  expect((await refused.json()).code).toBe('language_not_supported_on_tier');
  const ok = await post({ ...LITE, ttsBackend: 'elevenlabs', ttsModel: 'eleven_flash_v2_5', globalSettings: { language: 'es' } });
  expect(ok.status).toBe(201);
  expect(inserted).toMatchObject({ tts_backend: 'elevenlabs' });
  expect(inserted?.voice_id ?? null).toBeNull();
});
