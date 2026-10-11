import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Spend accounting: every Claude call (SDK and raw fetch) must land in the shared llmUsage client with the right
// feature label and model, and nothing may be sent when no key is configured.

const WORKER = 'app-failure-reporter';
const ORIGINAL_FETCH = global.fetch;
type Row = { day: string; model: string; feature: string; calls: number; errors: number; input_tokens: number; output_tokens: number; cost_usd: number };
let posted: Row[] = [];
let anthropicCalls = 0;

const USAGE = { input_tokens: 1000, output_tokens: 200 };
const messageJson = (text: string, model = 'claude-haiku-4-5-20251001') =>
  ({ id: 'msg_1', type: 'message', role: 'assistant', model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: USAGE });

function sse(model: string) {
  const ev = (t: string, d: unknown) => `event: ${t}\ndata: ${JSON.stringify(d)}\n\n`;
  return (
    ev('message_start', { type: 'message_start', message: { ...messageJson('', model), content: [], usage: { input_tokens: 1000, output_tokens: 1 } } }) +
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } }) +
    ev('content_block_stop', { type: 'content_block_stop', index: 0 }) +
    ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 200 } }) +
    ev('message_stop', { type: 'message_stop' })
  );
}

function installFetch(anthropicBody: (req: { stream?: boolean; model: string }) => Response) {
  global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.includes(WORKER)) {
      posted.push(...(JSON.parse(String(init?.body)).items as Row[]));
      return new Response('{}', { status: 200 });
    }
    if (u.includes('api.anthropic.com')) {
      anthropicCalls++;
      return anthropicBody(JSON.parse(String(init?.body)));
    }
    throw new Error('unexpected fetch ' + u);
  }) as unknown as typeof fetch;
}

async function load() {
  vi.resetModules();
  return {
    usage: (await import('@/lib/llmUsageInstance')).llmUsage,
    anthropic: await import('@/lib/anthropic'),
    engine: await import('@/lib/textFlowEngine'),
  };
}

beforeEach(() => {
  posted = [];
  anthropicCalls = 0;
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-not-real');
  vi.stubEnv('LLM_USAGE_KEY', 'test-usage-key');
  vi.stubEnv('FAILURE_REPORTER_KEY', '');
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.unstubAllEnvs();
});

describe('llm usage accounting', () => {
  it('SDK path: records tokens under the feature label with the model that ran', async () => {
    installFetch(() => Response.json(messageJson('ok', 'claude-opus-5')));
    const { usage, anthropic } = await load();
    const client = anthropic.getAnthropicClient();
    await usage.withFeature('post_call_qa', () => client.messages.create({ model: 'claude-opus-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] }));
    await usage.flush();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ model: 'claude-opus-5', feature: 'post_call_qa', calls: 1, errors: 0, input_tokens: 1000, output_tokens: 200 });
    expect(posted[0].cost_usd).toBeGreaterThan(0);
  });

  it('the real QA lib labels itself post_call_qa and records the configured model', async () => {
    vi.stubEnv('CALL_QA_MODEL', 'claude-sonnet-5');
    installFetch(() => Response.json(messageJson(JSON.stringify({ sentiment: 'positive', score: 80, critique: 'fine' }), 'claude-sonnet-5')));
    const { usage } = await load();
    const { analyzeCallQuality } = await import('@/lib/callQa');
    await analyzeCallQuality({ transcript: 'Agent: hi\nUser: hello' });
    await usage.flush();
    expect(posted.map((r) => [r.feature, r.model])).toEqual([['post_call_qa', 'claude-sonnet-5']]);
  });

  it('the real post-call analysis lib labels itself post_call_analysis', async () => {
    installFetch(() => Response.json(messageJson(JSON.stringify({ call_summary: 's', call_successful: true, in_voicemail: false, user_sentiment: 'Neutral' }))));
    const { usage } = await load();
    const { extractCallAnalysis } = await import('@/lib/postCallAnalysis');
    await extractCallAnalysis('Agent: hi\nUser: hello').catch(() => undefined);
    await usage.flush();
    expect(posted.map((r) => r.feature)).toEqual(['post_call_analysis']);
  });

  it('a failed SDK call is recorded as an error with no cost', async () => {
    installFetch(() => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }), { status: 400 }));
    const { usage, anthropic } = await load();
    const client = anthropic.getAnthropicClient();
    await expect(usage.withFeature('assist', () => client.messages.create({ model: 'claude-opus-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] }))).rejects.toBeTruthy();
    await usage.flush();
    expect(posted[0]).toMatchObject({ feature: 'assist', calls: 1, errors: 1, cost_usd: 0 });
  });

  it('a streamed turn is recorded exactly once', async () => {
    installFetch((req) => new Response(sse(req.model), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const { usage, anthropic } = await load();
    const client = anthropic.getAnthropicClient();
    await usage.withFeature('chat', async () => {
      const s = client.messages.stream({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] });
      await s.finalMessage();
    });
    await usage.flush();
    expect(anthropicCalls).toBe(1);
    expect(posted.reduce((n, r) => n + r.calls, 0)).toBe(1);
    expect(posted[0]).toMatchObject({ feature: 'chat', input_tokens: 1000, output_tokens: 200 });
  });

  it('raw fetch path (text flow engine): records usage under the caller label and the response model', async () => {
    installFetch(() => Response.json(messageJson('Hello there', 'claude-haiku-4-5-20251001')));
    const { usage, engine } = await load();
    const out = await usage.withFeature('chat', () => engine.runOpeningTurn(null));
    expect(out.assistantMessages).toEqual(['Hello there']);
    await usage.flush();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ model: 'claude-haiku-4-5', feature: 'chat', calls: 1, errors: 0, input_tokens: 1000, output_tokens: 200 });
  });

  it('raw fetch path: an API error is recorded as an error row', async () => {
    installFetch(() => new Response('boom', { status: 500 }));
    const { usage, engine } = await load();
    await expect(usage.withFeature('simulator', () => engine.runOpeningTurn(null))).rejects.toThrow(/Anthropic API error/);
    await usage.flush();
    expect(posted[0]).toMatchObject({ feature: 'simulator', calls: 1, errors: 1 });
  });

  it('sends nothing when no key is configured', async () => {
    vi.stubEnv('LLM_USAGE_KEY', '');
    installFetch(() => Response.json(messageJson('Hello')));
    const { usage, engine, anthropic } = await load();
    expect(usage.enabled).toBe(false);
    await usage.withFeature('chat', () => engine.runOpeningTurn(null));
    await usage.withFeature('assist', () => anthropic.getAnthropicClient().messages.create({ model: 'claude-opus-5', max_tokens: 5, messages: [{ role: 'user', content: 'x' }] }));
    await usage.flush();
    expect(usage.pending()).toBe(0);
    expect(posted).toHaveLength(0);
    expect(anthropicCalls).toBe(2);
  });

  it('falls back to FAILURE_REPORTER_KEY', async () => {
    vi.stubEnv('LLM_USAGE_KEY', '');
    vi.stubEnv('FAILURE_REPORTER_KEY', 'fallback-key');
    installFetch(() => Response.json(messageJson('Hello')));
    const { usage } = await load();
    expect(usage.enabled).toBe(true);
  });
});
