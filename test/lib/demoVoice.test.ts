import { describe, it, expect } from 'vitest';
import { demoTtsModel, demoTtsFields, demoAudioFields, DEFAULT_DEMO_TTS_MODEL, DEMO_SFX_PROMPT_HINT } from '@/lib/demoVoice';
import { buildIntroFlow } from '@/lib/introFlow';

describe('demoTtsModel', () => {
  it('defaults to eleven_v4_turbo', () => {
    expect(DEFAULT_DEMO_TTS_MODEL).toBe('eleven_v4_turbo');
    expect(demoTtsModel({})).toBe('eleven_v4_turbo');
    expect(demoTtsModel({ NEXT_PUBLIC_DEMO_TTS_MODEL: '   ' })).toBe('eleven_v4_turbo');
  });
  it('is overridable by NEXT_PUBLIC_DEMO_TTS_MODEL (e.g. rollback to eleven_turbo_v2_5)', () => {
    expect(demoTtsModel({ NEXT_PUBLIC_DEMO_TTS_MODEL: 'eleven_turbo_v2_5' })).toBe('eleven_turbo_v2_5');
  });
  it('ignores a malformed override instead of sending junk to the engine', () => {
    expect(demoTtsModel({ NEXT_PUBLIC_DEMO_TTS_MODEL: 'bad model; drop' })).toBe('eleven_v4_turbo');
  });
});

describe('demoTtsFields', () => {
  it('elevenlabs (or unset) -> backend + model', () => {
    expect(demoTtsFields(undefined, {})).toEqual({ ttsBackend: 'elevenlabs', ttsModel: 'eleven_v4_turbo' });
    expect(demoTtsFields('elevenlabs', {})).toEqual({ ttsBackend: 'elevenlabs', ttsModel: 'eleven_v4_turbo' });
  });
  it('a tenant on another backend keeps it and gets no ElevenLabs model', () => {
    expect(demoTtsFields('kokoro', {})).toEqual({ ttsBackend: 'kokoro' });
  });
});

describe('demoAudioFields', () => {
  it('opts in for the intro demo and for tenant-less sample demos', () => {
    expect(demoAudioFields({ intro: true })).toEqual({ demoAudio: true });
    expect(demoAudioFields({ intro: false, tenantId: null })).toEqual({ demoAudio: true });
    expect(demoAudioFields({ intro: false })).toEqual({ demoAudio: true });
  });
  it('does not opt in for a tenant-scoped (focused) demo', () => {
    expect(demoAudioFields({ intro: false, tenantId: 't_123' })).toEqual({});
  });
});

describe('sound-effect prompt hint', () => {
  it('is conditional on the tool existing, names the one moment, and is part of the intro business persona only', () => {
    expect(DEMO_SFX_PROMPT_HINT).toMatch(/If you have a play_sound_effect tool/);
    expect(DEMO_SFX_PROMPT_HINT).toMatch(/confirm a specific appointment or booking/);
    // the tool call ends the model's message, so it must come LAST or the agent cuts itself off before reading details back
    expect(DEMO_SFX_PROMPT_HINT).toMatch(/COMPLETE reply out loud/);
    expect(DEMO_SFX_PROMPT_HINT).toMatch(/very last thing/);
    expect(DEMO_SFX_PROMPT_HINT).toMatch(/Never call it before you have finished speaking/);
    const nodes = buildIntroFlow().nodes;
    expect(nodes.find((n) => n.id === 'business')!.prompt).toContain(DEMO_SFX_PROMPT_HINT);
    expect(nodes.find((n) => n.id === 'intro')!.prompt).not.toContain('play_sound_effect');
    expect(nodes.find((n) => n.id === 'wrapup')!.prompt).not.toContain('play_sound_effect');
  });
});
