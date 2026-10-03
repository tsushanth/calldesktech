import { describe, it, expect } from 'vitest';
import { DEFAULT_LLM_MODEL, LLM_MODELS, TTS_MODELS, getModelCatalog, isValidLlmModel, isValidTtsModel, validateModelChoice } from '@/lib/modelCatalog';

describe('model catalog', () => {
  it('has exactly one default LLM and it is Haiku 4.5', () => {
    expect(LLM_MODELS.filter((m) => m.default).map((m) => m.id)).toEqual([DEFAULT_LLM_MODEL]);
    expect(DEFAULT_LLM_MODEL).toBe('claude-haiku-4-5-20251001');
  });
  it('every model has an id and notes, and ids are unique', () => {
    const ids = [...LLM_MODELS.map((m) => m.id), ...TTS_MODELS.map((m) => m.backend + '/' + m.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of LLM_MODELS) { expect(m.notes.length).toBeGreaterThan(10); }
  });
  it('the preview model is marked preview and the tested ones are not', () => {
    expect(LLM_MODELS.find((m) => m.id === 'gemini-2.5-flash-lite')!.status).toBe('preview');
    expect(LLM_MODELS.find((m) => m.id === 'gpt-6-luna')!.status).toBe('tested');
  });
  it('mirrors the voice engine allowlist for ElevenLabs and Cartesia models', () => {
    // call-loop-poc/server.js VALID_TTS_MODELS
    expect(TTS_MODELS.filter((m) => m.backend === 'elevenlabs').map((m) => m.id).sort()).toEqual(['eleven_flash_v2_5', 'eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_v4_turbo']);
    expect(TTS_MODELS.filter((m) => m.backend === 'cartesia').map((m) => m.id).sort()).toEqual(['sonic-2', 'sonic-3.6']);
  });
  it('getModelCatalog exposes the lists, the default and the notes', () => {
    const c = getModelCatalog();
    expect(c.defaults.llmModel).toBe(DEFAULT_LLM_MODEL);
    expect(c.llmModels).toBe(LLM_MODELS);
    expect(c.notes.length).toBeGreaterThan(0);
  });
});

describe('validators', () => {
  it('isValidLlmModel only accepts catalog ids', () => {
    expect(isValidLlmModel('gpt-6-luna')).toBe(true);
    expect(isValidLlmModel('gpt-4o')).toBe(false);
    expect(isValidLlmModel(42)).toBe(false);
    expect(isValidLlmModel(undefined)).toBe(false);
  });
  it('isValidTtsModel requires the model to belong to the backend', () => {
    expect(isValidTtsModel('elevenlabs', 'eleven_v4_turbo')).toBe(true);
    expect(isValidTtsModel('cartesia', 'eleven_v4_turbo')).toBe(false);
    expect(isValidTtsModel('kokoro', 'eleven_v4_turbo')).toBe(false);
    expect(isValidTtsModel(null, 'eleven_v4_turbo')).toBe(false);
  });
});

describe('validateModelChoice', () => {
  it('no model fields is always fine, for either engine', () => {
    expect(validateModelChoice({ voiceEngine: 'poc' })).toBeNull();
    expect(validateModelChoice({ voiceEngine: 'retell' })).toBeNull();
    expect(validateModelChoice({ voiceEngine: 'poc', llmModel: null, ttsModel: null })).toBeNull();
  });
  it('accepts a valid pair on the poc engine', () => {
    expect(validateModelChoice({ voiceEngine: 'poc', llmModel: 'gpt-6-luna', ttsModel: 'eleven_flash_v2_5', ttsBackend: 'elevenlabs' })).toBeNull();
  });
  it('rejects an unknown llmModel and lists the valid ids', () => {
    const e = validateModelChoice({ voiceEngine: 'poc', llmModel: 'gpt-4o' });
    expect(e).toContain('Unknown llmModel "gpt-4o"');
    expect(e).toContain('claude-haiku-4-5-20251001');
  });
  it('rejects model fields on the retell engine', () => {
    expect(validateModelChoice({ voiceEngine: 'retell', llmModel: 'gpt-6-luna' })).toContain('in-house voice engine');
    expect(validateModelChoice({ voiceEngine: 'retell', ttsModel: 'eleven_flash_v2_5', ttsBackend: 'elevenlabs' })).toContain('in-house voice engine');
  });
  it('rejects a ttsModel without a model-bearing backend, or from the wrong backend', () => {
    expect(validateModelChoice({ voiceEngine: 'poc', ttsModel: 'eleven_flash_v2_5' })).toContain('no model choice');
    expect(validateModelChoice({ voiceEngine: 'poc', ttsModel: 'eleven_flash_v2_5', ttsBackend: 'kokoro' })).toContain('no model choice');
    const wrong = validateModelChoice({ voiceEngine: 'poc', ttsModel: 'sonic-2', ttsBackend: 'elevenlabs' });
    expect(wrong).toContain('Unknown ttsModel "sonic-2" for backend "elevenlabs"');
    expect(wrong).toContain('eleven_v4_turbo');
  });
});
