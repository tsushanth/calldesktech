import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { carryOverFromVersion } from '@/lib/versionCarryOver';

const base = { voice_engine: 'poc', voice_id: 'v-1', tts_backend: 'elevenlabs', llm_model: null, tts_model: null, tier: null, tier_overrides: null };

describe('carryOverFromVersion', () => {
  it('carries voice, models, tier and overrides from a tiered version', () => {
    const r = carryOverFromVersion({ ...base, tier: 'pro', llm_model: 'claude-sonnet-4-6', tts_model: 'eleven_v4_turbo', tier_overrides: ['llmModel'] });
    expect(r.dropped).toEqual([]);
    expect(r.body).toEqual({ voiceId: 'v-1', ttsBackend: 'elevenlabs', llmModel: 'claude-sonnet-4-6', ttsModel: 'eleven_v4_turbo', tier: 'pro', tierOverrides: ['llmModel'] });
  });
  it('carries a legacy (no tier) version with explicit models and sets no tier fields', () => {
    const r = carryOverFromVersion({ ...base, llm_model: 'gpt-6-luna', tts_model: 'eleven_flash_v2_5' });
    expect(r.body).toMatchObject({ llmModel: 'gpt-6-luna', ttsModel: 'eleven_flash_v2_5', tier: undefined, tierOverrides: undefined });
  });
  it('nulls become undefined, so an unset field stays unset', () => {
    const r = carryOverFromVersion({ ...base, voice_id: null, tts_backend: null });
    expect(r.body).toEqual({ voiceId: undefined, ttsBackend: undefined, llmModel: undefined, ttsModel: undefined, tier: undefined, tierOverrides: undefined });
  });
  it('drops a model the catalog no longer has (e.g. the retired gemini-2.5-flash-lite) instead of failing, and says so', () => {
    const r = carryOverFromVersion({ ...base, tier: 'standard', llm_model: 'gemini-2.5-flash-lite', tier_overrides: ['llmModel'] });
    expect(r.dropped).toEqual(['llmModel']);
    expect(r.body.llmModel).toBeUndefined();
    expect(r.body.tier).toBe('standard');
    expect(r.body.tierOverrides).toBeUndefined();
  });
  it('drops a tts model that does not belong to the backend', () => {
    const r = carryOverFromVersion({ ...base, tts_backend: 'cartesia', tts_model: 'eleven_v4_turbo' });
    expect(r.dropped).toEqual(['ttsModel']);
    expect(r.body.ttsModel).toBeUndefined();
  });
  it('drops a tier that cannot be published (unknown, coming soon, or not on the poc engine)', () => {
    expect(carryOverFromVersion({ ...base, tier: 'enterprise' }).dropped).toEqual(['tier']);
    expect(carryOverFromVersion({ ...base, tier: 'lite' }).body.tier).toBeUndefined();
    const retell = carryOverFromVersion({ ...base, voice_engine: 'retell', tier: 'standard' });
    expect(retell.body.tier).toBeUndefined();
  });
  it('ignores junk tier_overrides entries', () => {
    const r = carryOverFromVersion({ ...base, tier: 'pro', llm_model: 'claude-sonnet-4-6', tier_overrides: ['llmModel', 'bogus', 'ttsModel'] });
    expect(r.body.tierOverrides).toEqual(['llmModel']);
  });
});

describe('every place that builds a version from another one uses the helper', () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
  it('dashboard restore and Copilot accept', () => {
    expect(read('src/app/dashboard/agents/[id]/page.tsx')).toContain('...carryOverFromVersion(v).body');
    expect(read('src/app/api/agents/[id]/copilot/suggestions/[suggestionId]/route.ts')).toContain('...carryOverFromVersion(latestVersion).body');
  });
});
