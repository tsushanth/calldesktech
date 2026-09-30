import { describe, it, expect, vi } from 'vitest';
import { makeWavGenerator } from '@/lib/callAudio/generate';

const wav = (tag: string) => Buffer.from(tag);
const deps = () => ({
  elevenlabs: vi.fn(async () => wav('eleven')),
  readaloud: vi.fn(async () => wav('readaloud')),
});

describe('makeWavGenerator (provider switch)', () => {
  it('defaults to ElevenLabs while ReadAloud sound effects are being perfected', async () => {
    const d = deps();
    const out = await makeWavGenerator({ ELEVENLABS_API_KEY: 'el', READALOUD_API_KEY: 'ra' }, d)({ prompt: 'p', durationSec: 2 });
    expect(out).toEqual(wav('eleven'));
    expect(d.readaloud).not.toHaveBeenCalled();
    expect(d.elevenlabs).toHaveBeenCalledWith({ prompt: 'p', durationSec: 2 }, expect.objectContaining({ apiKey: 'el' }));
  });
  it('prefers a dedicated ELEVENLABS_SOUNDS_API_KEY over the general key (the general key may be permission-restricted: in production it lacks sound_generation)', async () => {
    const d = deps();
    await makeWavGenerator({ ELEVENLABS_SOUNDS_API_KEY: 'sounds', ELEVENLABS_API_KEY: 'general' }, d)({ prompt: 'p', durationSec: 2 });
    expect(d.elevenlabs).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apiKey: 'sounds' }));
  });
  it('falls back to ELEVENLABS_API_KEY when no dedicated key is set, and ignores a blank dedicated key', async () => {
    const d = deps();
    await makeWavGenerator({ ELEVENLABS_API_KEY: 'general' }, d)({ prompt: 'p', durationSec: 2 });
    expect(d.elevenlabs).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ apiKey: 'general' }));
    await makeWavGenerator({ ELEVENLABS_SOUNDS_API_KEY: '  ', ELEVENLABS_API_KEY: 'general' }, d)({ prompt: 'p', durationSec: 2 });
    expect(d.elevenlabs).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ apiKey: 'general' }));
  });
  it('CALL_AUDIO_PROVIDER=readaloud switches back, with the ReadAloud key and MCP url', async () => {
    const d = deps();
    const out = await makeWavGenerator({ CALL_AUDIO_PROVIDER: 'readaloud', READALOUD_API_KEY: 'ra', READALOUD_MCP_URL: 'https://x/mcp' }, d)({ prompt: 'p', durationSec: 2 });
    expect(out).toEqual(wav('readaloud'));
    expect(d.readaloud).toHaveBeenCalledWith({ prompt: 'p', durationSec: 2 }, expect.objectContaining({ apiKey: 'ra', url: 'https://x/mcp' }));
  });
  it('readaloud url falls back to the hosted MCP endpoint', async () => {
    const d = deps();
    await makeWavGenerator({ CALL_AUDIO_PROVIDER: 'readaloud', READALOUD_API_KEY: 'ra' }, d)({ prompt: 'p', durationSec: 2 });
    expect(d.readaloud).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ url: 'https://readaloudai.org/mcp' }));
  });
  it('an unknown provider fails closed instead of silently picking one', async () => {
    const d = deps();
    await expect(makeWavGenerator({ CALL_AUDIO_PROVIDER: 'nope' }, d)({ prompt: 'p', durationSec: 2 })).rejects.toMatchObject({ code: 'not_configured' });
    expect(d.elevenlabs).not.toHaveBeenCalled();
    expect(d.readaloud).not.toHaveBeenCalled();
  });
});
