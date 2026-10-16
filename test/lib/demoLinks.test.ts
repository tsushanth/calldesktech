import { describe, it, expect } from 'vitest';
import { buildDemoLinkConfig, isLinkLive, DEMO_SLUG, type DemoLinkRow } from '@/lib/demoLinks';

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
