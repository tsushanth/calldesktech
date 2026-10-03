import { describe, it, expect } from 'vitest';
import { buildSettingsVersionPayload } from '@/lib/settingsVersionPayload';

const flow = { flowName: 'v2', startNodeId: 's', nodes: [], wizardConfig: { booking: true } };
const prev = { voice_engine: 'poc', voice_id: 'v-1', tts_backend: 'elevenlabs', llm_model: 'claude-sonnet-4-6', tts_model: 'eleven_v4_turbo', tier: 'pro', tier_overrides: ['llmModel'] };
const wiz = { ...flow, voiceEngine: 'poc', ttsBackend: 'kokoro' as const };

describe('buildSettingsVersionPayload', () => {
  it('no previous version: unchanged behaviour (engine + backend only)', () => {
    expect(buildSettingsVersionPayload({ ...wiz })).toEqual({ ...flow, voiceEngine: 'poc', ttsBackend: 'kokoro' });
    expect(buildSettingsVersionPayload({ ...wiz, voiceEngine: 'retell' })).toMatchObject({ voiceEngine: 'retell', ttsBackend: undefined });
  });
  it('nothing touched: carries tier, overrides, models, voice and backend, ignoring the form defaults', () => {
    expect(buildSettingsVersionPayload({ ...wiz, previous: prev })).toEqual({
      ...flow, voiceEngine: 'poc', ttsBackend: 'elevenlabs', voiceId: 'v-1', llmModel: 'claude-sonnet-4-6', ttsModel: 'eleven_v4_turbo', tier: 'pro', tierOverrides: ['llmModel'],
    });
  });
  it('touching an option without changing its value changes nothing', () => {
    const p = buildSettingsVersionPayload({ ...wiz, ttsBackend: 'elevenlabs', previous: prev, engineTouched: true, backendTouched: true });
    expect(p).toMatchObject({ voiceId: 'v-1', ttsModel: 'eleven_v4_turbo', tier: 'pro', tierOverrides: ['llmModel'] });
  });
  it('backend changed: drops the tts model and voice id that no longer apply, keeps tier and llm model, re-derives overrides', () => {
    const p = buildSettingsVersionPayload({ ...wiz, ttsBackend: 'cartesia', previous: prev, backendTouched: true });
    expect(p).toMatchObject({ voiceEngine: 'poc', ttsBackend: 'cartesia', voiceId: undefined, ttsModel: undefined, llmModel: 'claude-sonnet-4-6', tier: 'pro', tierOverrides: undefined });
  });
  it('backend changed to one with matching models keeps a valid model only if it validates', () => {
    const p = buildSettingsVersionPayload({ ...wiz, ttsBackend: 'kokoro', previous: { ...prev, tts_model: 'sonic-2', tts_backend: 'cartesia' }, backendTouched: true });
    expect(p.ttsModel).toBeUndefined();
    expect(p.ttsBackend).toBe('kokoro');
  });
  it('engine changed to retell: drops tier, models, backend and voice', () => {
    const p = buildSettingsVersionPayload({ ...wiz, voiceEngine: 'retell', previous: prev, engineTouched: true });
    expect(p).toMatchObject({ voiceEngine: 'retell', ttsBackend: undefined, voiceId: undefined, llmModel: undefined, ttsModel: undefined, tier: undefined, tierOverrides: undefined });
  });
  it('engine changed retell to poc: uses the form backend, nothing to carry', () => {
    const p = buildSettingsVersionPayload({ ...wiz, ttsBackend: 'minimax', previous: { voice_engine: 'retell', voice_id: 'r-1', tts_backend: null }, engineTouched: true });
    expect(p).toMatchObject({ voiceEngine: 'poc', ttsBackend: 'minimax', voiceId: undefined, tier: undefined });
  });
  it('an untouched engine is not overridden by the form state', () => {
    expect(buildSettingsVersionPayload({ ...wiz, voiceEngine: 'retell', previous: prev })).toMatchObject({ voiceEngine: 'poc', tier: 'pro' });
  });
  it('a stale model from the previous version is dropped, not sent', () => {
    const p = buildSettingsVersionPayload({ ...wiz, previous: { ...prev, llm_model: 'gemini-2.5-flash-lite' } });
    expect(p.llmModel).toBeUndefined();
    expect(p.tier).toBe('pro');
  });
  it('previous legacy version without tier carries models and no tier fields', () => {
    const p = buildSettingsVersionPayload({ ...wiz, previous: { ...prev, tier: null, tier_overrides: null } });
    expect(p).toMatchObject({ llmModel: 'claude-sonnet-4-6', tier: undefined, tierOverrides: undefined });
  });
});
