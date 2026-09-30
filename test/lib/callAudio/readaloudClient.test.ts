import { describe, it, expect, vi } from 'vitest';
import { generateSoundEffectWav, ReadAloudError } from '@/lib/callAudio/readaloudClient';

const WAV = Buffer.from('RIFFfakewav');
const okBody = (extra: object = {}) => ({
  jsonrpc: '2.0', id: 1,
  result: { content: [{ type: 'audio', data: WAV.toString('base64'), mimeType: 'audio/wav' }, { type: 'text', text: 'Generated.' }], ...extra },
});
const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sseRes = (body: unknown) =>
  new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });

const opts = (fetchImpl: typeof fetch) => ({ apiKey: 'ra_test_key', url: 'https://mcp.example/mcp', fetchImpl });

describe('generateSoundEffectWav', () => {
  it('calls the MCP generate_sound_effect tool with bearer auth and returns the WAV bytes', async () => {
    const f = vi.fn(async () => jsonRes(okBody()));
    const out = await generateSoundEffectWav({ prompt: 'a soft chime', durationSec: 2 }, opts(f as unknown as typeof fetch));
    expect(out).toEqual(WAV);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://mcp.example/mcp');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ra_test_key');
    expect((init.headers as Record<string, string>).Accept).toContain('application/json');
    expect((init.headers as Record<string, string>).Accept).toContain('text/event-stream');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'generate_sound_effect', arguments: { prompt: 'a soft chime', duration_sec: 2 } } });
  });

  it('also parses a text/event-stream response', async () => {
    const out = await generateSoundEffectWav({ prompt: 'x', durationSec: 2 }, opts((async () => sseRes(okBody())) as unknown as typeof fetch));
    expect(out).toEqual(WAV);
  });

  it.each([
    [401, 'unauthorized', false],
    [429, 'rate_limited', true],
    [503, 'upstream', true],
  ])('maps HTTP %i to %s (retryable=%s)', async (status, code, retryable) => {
    const f = (async () => new Response('nope', { status })) as unknown as typeof fetch;
    await expect(generateSoundEffectWav({ prompt: 'x', durationSec: 2 }, opts(f))).rejects.toMatchObject({ name: 'ReadAloudError', code, retryable });
  });

  it.each([
    ['payment_required', false],
    ['rate_limited', true],
    ['capacity', true],
    ['upstream', true],
  ])('maps a tool error whose text names "%s"', async (code, retryable) => {
    const body = { jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: `[${code}] something went wrong` }] } };
    await expect(generateSoundEffectWav({ prompt: 'x', durationSec: 2 }, opts((async () => jsonRes(body)) as unknown as typeof fetch)))
      .rejects.toMatchObject({ code, retryable });
  });

  it('a still-generating result (no audio, job id) is a retryable "pending" error, not silent success', async () => {
    const body = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'Still generating (job abc).' }], structuredContent: { job_id: 'abc', status: 'processing' } } };
    await expect(generateSoundEffectWav({ prompt: 'x', durationSec: 2 }, opts((async () => jsonRes(body)) as unknown as typeof fetch)))
      .rejects.toMatchObject({ code: 'pending', retryable: true });
  });

  it('a JSON-RPC level error is surfaced', async () => {
    const body = { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'bad' } };
    await expect(generateSoundEffectWav({ prompt: 'x', durationSec: 2 }, opts((async () => jsonRes(body)) as unknown as typeof fetch)))
      .rejects.toBeInstanceOf(ReadAloudError);
  });

  it('a network failure is a retryable upstream error', async () => {
    const f = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    await expect(generateSoundEffectWav({ prompt: 'x', durationSec: 2 }, opts(f))).rejects.toMatchObject({ code: 'upstream', retryable: true });
  });

  it('validates input before any network call: empty/oversized prompt, duration outside 1-12s', async () => {
    const f = vi.fn();
    const o = opts(f as unknown as typeof fetch);
    await expect(generateSoundEffectWav({ prompt: '  ', durationSec: 2 }, o)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(generateSoundEffectWav({ prompt: 'x'.repeat(501), durationSec: 2 }, o)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(generateSoundEffectWav({ prompt: 'x', durationSec: 0.5 }, o)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(generateSoundEffectWav({ prompt: 'x', durationSec: 13 }, o)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(f).not.toHaveBeenCalled();
  });

  it('fails closed with a clear error when no API key is configured', async () => {
    const f = vi.fn();
    await expect(generateSoundEffectWav({ prompt: 'x', durationSec: 2 }, { apiKey: '', url: 'u', fetchImpl: f as unknown as typeof fetch }))
      .rejects.toMatchObject({ code: 'not_configured' });
    expect(f).not.toHaveBeenCalled();
  });
});
