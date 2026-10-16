import { describe, it, expect } from 'vitest';
import { buildDemoLinkConfig, isLinkLive, parseVoiceOptions, applyVoice, DEMO_SLUG, type DemoLinkRow } from '@/lib/demoLinks';

const link: DemoLinkRow = { slug: 'abcdEFGH12345678abcd', label: 'Demo line', max_seconds: 300, expires_at: '2026-11-01T00:00:00Z', enabled: true };
const version = { tts_backend: 'elevenlabs', tts_model: 'eleven_flash_v2_5', voice_id: ' M7ya1YbaeFaPXljg9BpK ', llm_model: 'gemini-3.1-flash-lite' };
const flowRow = { nodes: [{ id: 'opening', type: 'greeting', prompt: 'hi' }, { id: 'bye', type: 'goodbye', prompt: 'bye' }], global_settings: { startNodeId: 'opening', returnToFlow: true, maxCallDurationSec: 600 } };

describe('isLinkLive', () => {
  it('needs the link enabled and not yet expired', () => {
    const now = Date.parse('2026-10-20T00:00:00Z');
    expect(isLinkLive(link, now)).toBe(true);
    expect(isLinkLive({ ...link, enabled: false }, now)).toBe(false);
    expect(isLinkLive({ ...link, expires_at: '2026-10-19T23:59:59Z' }, now)).toBe(false);
    expect(isLinkLive({ ...link, expires_at: 'garbage' }, now)).toBe(false);
  });
});

describe('DEMO_SLUG', () => {
  it('accepts long url-safe slugs only', () => {
    expect(DEMO_SLUG.test('abcdEFGH12345678abcd')).toBe(true);
    for (const s of ['', 'short', 'has space in it here!!', '../../etc/passwd/aaaa', 'a'.repeat(65)]) expect(DEMO_SLUG.test(s)).toBe(false);
  });
});

describe('buildDemoLinkConfig', () => {
  it('builds the flow, voice and a time cap, and trims the voice id', () => {
    const c = buildDemoLinkConfig(link, version, flowRow)!;
    expect(c.label).toBe('Demo line');
    expect(c.flow.startNodeId).toBe('opening');
    expect(c.flow.nodes).toHaveLength(2);
    expect(c.context).toEqual({ ttsBackend: 'elevenlabs', ttsModel: 'eleven_flash_v2_5', voiceId: 'M7ya1YbaeFaPXljg9BpK', model: 'gemini-3.1-flash-lite' });
  });
  it('caps the call at the shorter of the link and the flow, and keeps the flow settings', () => {
    expect(buildDemoLinkConfig(link, version, flowRow)!.maxSeconds).toBe(300);
    expect(buildDemoLinkConfig({ ...link, max_seconds: 900 }, version, flowRow)!.maxSeconds).toBe(600);
    expect(buildDemoLinkConfig(link, version, { ...flowRow, global_settings: { startNodeId: 'opening' } })!.maxSeconds).toBe(300);
    expect(buildDemoLinkConfig(link, version, flowRow)!.flow.globalSettings).toMatchObject({ returnToFlow: true, maxCallDurationSec: 300 });
  });
  it('starts at the first node when no start node is set, and omits unset voice fields', () => {
    const c = buildDemoLinkConfig(link, { tts_backend: null, tts_model: null, voice_id: '  ', llm_model: null }, { nodes: flowRow.nodes, global_settings: null })!;
    expect(c.flow.startNodeId).toBe('opening');
    expect(c.context).toEqual({});
  });
  it('is null for an agent with no usable flow', () => {
    expect(buildDemoLinkConfig(link, version, { nodes: [], global_settings: null })).toBeNull();
    expect(buildDemoLinkConfig(link, version, { nodes: null, global_settings: null })).toBeNull();
    expect(buildDemoLinkConfig(link, version, { nodes: [{ type: 'greeting' }], global_settings: null })).toBeNull();
  });
  it('never carries a workspace id: the browser session must stay anonymous', () => {
    const json = JSON.stringify(buildDemoLinkConfig(link, version, flowRow));
    expect(json).not.toMatch(/tenant/i);
  });
});


const NZ = { key: 'nz', label: 'New Zealand', detail: 'Jenna', voice_id: '7R9vnLAE0ZSpY0xWp0mv' };
const AU = { key: 'au', label: 'Australian', detail: 'Hannah', voice_id: 'M7ya1YbaeFaPXljg9BpK' };

describe('parseVoiceOptions', () => {
  it('reads valid options in order', () => {
    expect(parseVoiceOptions([NZ, AU])).toEqual([
      { key: 'nz', label: 'New Zealand', detail: 'Jenna', voiceId: '7R9vnLAE0ZSpY0xWp0mv' },
      { key: 'au', label: 'Australian', detail: 'Hannah', voiceId: 'M7ya1YbaeFaPXljg9BpK' },
    ]);
  });
  it('returns [] for anything that is not an array', () => {
    for (const v of [null, undefined, 'x', 3, {}, { key: 'a' }]) expect(parseVoiceOptions(v)).toEqual([]);
  });
  it('drops malformed entries instead of failing the whole list', () => {
    const out = parseVoiceOptions([NZ, null, 'x', { ...AU, key: 'Bad Key!' }, { ...AU, voice_id: 'short' }, { ...AU, voice_id: 'has spaces in it ok' }, { ...AU, label: '' }, { ...AU, label: 'x'.repeat(31) }, AU]);
    expect(out.map((o) => o.key)).toEqual(['nz', 'au']);
  });
  it('drops duplicate keys and duplicate voices, and caps the list at six', () => {
    expect(parseVoiceOptions([NZ, { ...AU, key: 'nz' }, { ...AU, voice_id: NZ.voice_id }]).map((o) => o.key)).toEqual(['nz']);
    const many = Array.from({ length: 9 }, (_, i) => ({ key: `v${i}`, label: `V${i}`, voice_id: `voiceid${String(i).padStart(4, '0')}` }));
    expect(parseVoiceOptions(many)).toHaveLength(6);
  });
  it('accepts voiceId as well as voice_id', () => {
    expect(parseVoiceOptions([{ key: 'nz', label: 'NZ', voiceId: NZ.voice_id }])[0].voiceId).toBe(NZ.voice_id);
  });
});

describe('voices in the link config', () => {
  it('offers the picker only when there are two or more options, defaulting to the agent\'s own voice', () => {
    const c = buildDemoLinkConfig({ ...link, voice_options: [NZ, AU] }, version, flowRow)!;
    expect(c.voices?.map((v) => v.key)).toEqual(['nz', 'au']);
    expect(c.defaultVoiceKey).toBe('au'); // the agent's voice (M7ya...) is the Australian option
  });
  it('defaults to the first option when the agent voice is not among them', () => {
    const c = buildDemoLinkConfig({ ...link, voice_options: [NZ, { ...AU, voice_id: 'anotherVoice123' }] }, version, flowRow)!;
    expect(c.defaultVoiceKey).toBe('nz');
  });
  it('shows no picker for none, one, or garbage', () => {
    for (const vo of [undefined, null, [], [NZ], 'junk']) {
      const c = buildDemoLinkConfig({ ...link, voice_options: vo }, version, flowRow)!;
      expect(c.voices).toBeUndefined();
      expect(c.defaultVoiceKey).toBeUndefined();
    }
  });
});

describe('applyVoice', () => {
  const voices = parseVoiceOptions([NZ, AU]);
  const ctx = { ttsBackend: 'elevenlabs', voiceId: 'M7ya1YbaeFaPXljg9BpK' };
  it('swaps only the voice id for a known key, without mutating the input', () => {
    const out = applyVoice(ctx, voices, 'nz');
    expect(out).toEqual({ ttsBackend: 'elevenlabs', voiceId: NZ.voice_id });
    expect(ctx.voiceId).toBe('M7ya1YbaeFaPXljg9BpK');
  });
  it('leaves the context alone for an unknown key or no options', () => {
    expect(applyVoice(ctx, voices, 'nope')).toBe(ctx);
    expect(applyVoice(ctx, undefined, 'nz')).toBe(ctx);
    expect(applyVoice(ctx, voices, undefined)).toBe(ctx);
  });
});
