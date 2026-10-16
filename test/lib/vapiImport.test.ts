import { describe, it, expect } from 'vitest';
import { vapiAssistantToFlow, type VapiImportOk } from '@/lib/vapiImport';

function ok(raw: unknown): VapiImportOk {
  const r = vapiAssistantToFlow(raw);
  if (!r.ok) throw new Error(r.error);
  return r;
}
const sys = (content: string) => ({ role: 'system', content });

function assertWellFormed(r: VapiImportOk) {
  const ids = r.nodes.map((n) => n.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toContain(r.startNodeId);
  for (const n of r.nodes) for (const e of n.edges) expect(ids).toContain(e.target);
  const edgeIds = r.nodes.flatMap((n) => n.edges.map((e) => e.id));
  expect(new Set(edgeIds).size).toBe(edgeIds.length);
}

const FULL = {
  name: 'Riley - Front Desk',
  firstMessage: 'Hi, thanks for calling Bright Dental. How can I help?',
  endCallMessage: 'Thanks for calling, goodbye!',
  maxDurationSeconds: 420,
  silenceTimeoutSeconds: 30,
  transcriber: { provider: 'deepgram', model: 'nova-2', language: 'es' },
  voice: { provider: '11labs', voiceId: 'abc123' },
  model: {
    provider: 'openai', model: 'gpt-4o', temperature: 0.4,
    messages: [sys('You are Riley, the receptionist for {{clinic_name}}. Today is {{now}}. Caller: {{customer.number}}.')],
    toolIds: ['tool-saved-1'],
    tools: [
      { type: 'endCall' },
      { type: 'transferCall', destinations: [{ type: 'number', number: '+14155550100', message: 'One moment, connecting you.', description: 'caller needs a dentist urgently', transferPlan: { mode: 'warm-transfer-say-message' } }, { type: 'sip', sipUri: 'sip:x@y.com' }] },
      { type: 'function', function: { name: 'check_availability', description: 'Check open appointment slots.', parameters: { type: 'object', properties: { date: { type: 'string' }, treatment: { type: 'string' } }, required: ['date'] } }, server: { url: 'https://example.com/hook', headers: { Authorization: 'x' } } },
      { type: 'apiRequest', url: 'https://example.com' },
      { type: 'dtmf' },
    ],
  },
  server: { url: 'https://example.com/events' },
  analysisPlan: { summaryPlan: {} },
  backgroundSound: 'office',
};

describe('vapiAssistantToFlow: the simple case', () => {
  const r = ok({ firstMessage: 'Hello there', model: { provider: 'openai', model: 'gpt-4o', messages: [sys('Be helpful.')] } });
  it('makes one main step with the prompt and a fixed greeting', () => {
    expect(r.nodes).toHaveLength(1);
    expect(r.nodes[0]).toMatchObject({ id: 'main', type: 'greeting', prompt: 'Be helpful.', params: { spokenMessage: 'Hello there' } });
    assertWellFormed(r);
  });
  it('adds no goodbye step when nothing asked for one', () => {
    expect(r.nodes.find((n) => n.type === 'goodbye')).toBeUndefined();
  });
});

describe('vapiAssistantToFlow: a full assistant', () => {
  const r = ok(FULL);
  it('is a well formed flow', () => assertWellFormed(r));
  it('keeps the system prompt and fixed greeting on the main step', () => {
    const main = r.nodes.find((n) => n.id === 'main')!;
    expect(main.prompt).toContain('You are Riley');
    expect(main.params?.spokenMessage).toBe('Hi, thanks for calling Bright Dental. How can I help?');
  });
  it('turns endCall plus the end message into a goodbye step', () => {
    const g = r.nodes.find((n) => n.type === 'goodbye')!;
    expect(g.prompt).toContain('Thanks for calling, goodbye!');
    expect(r.nodes.find((n) => n.id === 'main')!.edges.some((e) => e.target === 'goodbye')).toBe(true);
  });
  it('makes a warm transfer step for the phone destination and skips the SIP one', () => {
    const t = r.nodes.filter((n) => n.type === 'transfer');
    expect(t).toHaveLength(1);
    expect(t[0].params).toMatchObject({ transferTo: '+14155550100', transferMode: 'warm' });
    expect(t[0].prompt).toBe('One moment, connecting you.');
    const edge = r.nodes.find((n) => n.id === 'main')!.edges.find((e) => e.target === t[0].id)!;
    expect(edge.condition).toBe('caller needs a dentist urgently');
    expect(r.report.skipped.some((n) => /sip transfer/i.test(n.text))).toBe(true);
  });
  it('turns the function tool into collect -> webhook -> back to main', () => {
    const collect = r.nodes.find((n) => n.id === 'check_availability_collect')!;
    const call = r.nodes.find((n) => n.id === 'check_availability_call')!;
    expect(collect).toMatchObject({ type: 'extraction', extract: { date: 'string', treatment: 'string' } });
    expect(collect.edges[0].target).toBe('check_availability_call');
    expect(call).toMatchObject({ type: 'function', function: 'check_availability', params: { webhookUrl: 'https://example.com/hook' } });
    expect(call.edges[0]).toMatchObject({ condition: 'always', target: 'main' });
    expect(r.nodes.find((n) => n.id === 'main')!.edges.some((e) => e.target === 'check_availability_collect' && e.condition === 'Check open appointment slots.')).toBe(true);
  });
  it('writes argument types, allowed values and required flags into the collect prompt', () => {
    const r2 = ok({
      model: { messages: [sys('Book visits.')], tools: [{
        type: 'function', server: { url: 'https://example.com/h' },
        function: { name: 'book', description: 'Book a visit.', parameters: { type: 'object', required: ['party_size', 'room'], properties: {
          party_size: { type: 'integer', description: 'How many people' },
          room: { type: 'string', enum: ['a', 'b'] },
          note: { type: 'string' },
        } } },
      }] },
    });
    const collect = r2.nodes.find((n) => n.id === 'book_collect')!;
    expect(collect.extract).toEqual({ party_size: 'string', room: 'string', note: 'string' });
    expect(collect.prompt).toContain('- party_size (integer, required): How many people');
    expect(collect.prompt).toContain('- room (one of: a, b, required)');
    expect(collect.prompt).toContain('- note (string, optional)');
    assertWellFormed(r2);
  });
  it('carries over language and limits', () => {
    expect(r.settings).toEqual({ language: 'es', maxCallDurationSec: 420, endCallAfterSilenceSec: 30 });
  });
  it('reports what it could not carry over, and what needs a look', () => {
    const skipped = r.report.skipped.map((n) => n.area);
    expect(skipped).toEqual(expect.arrayContaining(['Voice', 'Model', 'Webhooks', 'Analysis', 'Sound', 'Tools']));
    const review = r.report.review.map((n) => n.area + ':' + n.text).join('\n');
    expect(review).toMatch(/Saved tools/);
    expect(review).toMatch(/tool-saved-1/);
    expect(review).toMatch(/authentication/);
    expect(review).toMatch(/keypad/i);
  });
  it('separates plain variables from names Vapi fills itself', () => {
    expect(r.variables).toEqual(['clinic_name']);
    const txt = r.report.review.filter((n) => n.area === 'Variables').map((n) => n.text).join(' ');
    expect(txt).toContain('{{clinic_name}}');
    expect(txt).toContain('{{now}}');
    expect(txt).toContain('{{customer.number}}');
  });
  it('uses the assistant name', () => expect(r.name).toBe('Riley - Front Desk'));
});

describe('vapiAssistantToFlow: saved tools and wrappers', () => {
  it('resolves toolIds from a supplied tools list', () => {
    const r = ok({
      assistant: { model: { messages: [sys('Help.')], toolIds: ['t1'] } },
      tools: [{ id: 't1', type: 'function', function: { name: 'lookup_order', description: 'Look up an order', parameters: { type: 'object', properties: { order_id: { type: 'string' } } } }, server: { url: 'https://x.test/h' } }],
    });
    expect(r.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['lookup_order_collect', 'lookup_order_call']));
    expect(r.report.review.some((n) => n.area === 'Saved tools')).toBe(false);
    assertWellFormed(r);
  });
  it('accepts the assistant as a JSON string', () => {
    const r = ok(JSON.stringify({ firstMessage: 'Hi', model: { messages: [sys('Help.')] } }));
    expect(r.nodes[0].prompt).toBe('Help.');
  });
});

describe('vapiAssistantToFlow: opening modes and odd values', () => {
  it('leaves the fixed greeting off when the assistant waits for the caller', () => {
    const r = ok({ firstMessage: 'Hi', firstMessageMode: 'assistant-waits-for-user', model: { messages: [sys('Help.')] } });
    expect(r.nodes[0].params).toBeUndefined();
    expect(r.report.review.some((n) => n.area === 'Opening')).toBe(true);
  });
  it('does not use an audio URL as the greeting', () => {
    const r = ok({ firstMessage: 'https://x.test/hello.mp3', model: { messages: [sys('Help.')] } });
    expect(r.nodes[0].params).toBeUndefined();
    expect(r.report.skipped.some((n) => n.area === 'Opening')).toBe(true);
  });
  it('leaves a transfer number empty and says so when it is not +country-code', () => {
    const r = ok({ model: { messages: [sys('Help.')], tools: [{ type: 'transferCall', destinations: [{ type: 'number', number: '4155550100' }] }] } });
    expect(r.nodes.find((n) => n.type === 'transfer')!.params?.transferTo).toBe('');
    expect(r.report.review.some((n) => /not in \+country-code/.test(n.text))).toBe(true);
  });
  it('flags a function with no server URL', () => {
    const r = ok({ model: { messages: [sys('Help.')], tools: [{ type: 'function', function: { name: 'x', description: 'd' } }] } });
    expect(r.nodes.find((n) => n.id === 'x_call')!.params?.webhookUrl).toBe('');
    expect(r.report.review.some((n) => /no server URL/.test(n.text))).toBe(true);
  });
  it('keeps node and edge ids unique when two tools share a name', () => {
    const tool = { type: 'function', function: { name: 'dup', description: 'd', parameters: { type: 'object', properties: { a: { type: 'string' } } } }, server: { url: 'https://x.test' } };
    assertWellFormed(ok({ model: { messages: [sys('Help.')], tools: [tool, tool] } }));
  });
  it('joins several system messages', () => {
    const r = ok({ model: { messages: [sys('One.'), { role: 'assistant', content: 'example' }, sys('Two.')] } });
    expect(r.nodes[0].prompt).toBe('One.\n\nTwo.');
    expect(r.report.skipped.some((n) => n.area === 'Example messages')).toBe(true);
  });
  it('maps an English transcriber to no language change and an unknown one to a note', () => {
    expect(ok({ transcriber: { language: 'en-US' }, model: { messages: [sys('Help.')] } }).settings.language).toBeUndefined();
    const r = ok({ transcriber: { language: 'xx' }, model: { messages: [sys('Help.')] } });
    expect(r.settings.language).toBeUndefined();
    expect(r.report.review.some((n) => n.area === 'Language')).toBe(true);
  });
});

describe('vapiAssistantToFlow: bad input', () => {
  it('rejects invalid JSON with a plain message', () => {
    const r = vapiAssistantToFlow('{not json');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/not valid JSON/);
  });
  it('rejects things that are not an assistant', () => {
    expect(vapiAssistantToFlow([1, 2]).ok).toBe(false);
    expect(vapiAssistantToFlow({ hello: 'world' }).ok).toBe(false);
    expect(vapiAssistantToFlow(null).ok).toBe(false);
  });
  it('rejects an assistant with no system prompt', () => {
    const r = vapiAssistantToFlow({ model: { messages: [{ role: 'user', content: 'hi' }] } });
    expect(!r.ok && r.error).toMatch(/No system prompt/);
  });
  it('rejects absurdly large input', () => {
    const r = vapiAssistantToFlow('x'.repeat(400_001));
    expect(!r.ok && r.error).toMatch(/too large/);
  });
});

describe('the Vapi migration page wording', () => {
  // Imported lazily so the library module graph is not loaded by the tests above.
  it('mentions the importer for Vapi only, and keeps the by-hand wording for other platforms', async () => {
    const { categoryParagraph } = await import('@/lib/seoLibrary/migrate');
    const vapi = categoryParagraph({ slug: 'vapi', name: 'Vapi', category: 'platform' } as never);
    expect(vapi).toContain('Import from Vapi');
    expect(vapi).toContain('does not carry over the voice, model and knowledge base');
    expect(vapi).not.toContain('rather than import a file');
    const retell = categoryParagraph({ slug: 'retell-ai', name: 'Retell', category: 'platform' } as never);
    expect(retell).toContain('rather than import a file');
    expect(retell).not.toContain('Import from Vapi');
  });
});
