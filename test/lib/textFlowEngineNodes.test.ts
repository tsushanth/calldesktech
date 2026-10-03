// Text simulator: the node types the voice engine runs that the text engine used to ignore.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runOpeningTurn, runUserTurn } from '@/lib/textFlowEngine';
import type { FlowNode } from '@/types';

type Sent = { messages: { role: string; content: string }[]; tool_choice?: unknown };
let sent: Sent[];
let respond: (req: Sent) => unknown;
const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test';
  sent = [];
  respond = () => ({ content: [{ type: 'text', text: 'ok' }] });
  globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body)) as Sent;
    sent.push(req);
    return new Response(JSON.stringify(respond(req)), { status: 200 });
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

const node = (n: Partial<FlowNode> & { id: string; type: FlowNode['type'] }): FlowNode => ({ prompt: 'say hi', edges: [], ...n });
const lastUser = () => sent[sent.length - 1].messages.map((m) => m.content).join('\n');

describe('code node', () => {
  it('a code node reached mid-flow reads earlier data (dv) and merges its object result', async () => {
    const flow = {
      startNodeId: 'g',
      nodes: [
        node({ id: 'g', type: 'greeting', edges: [{ target: 'c', condition: 'ready' }] }),
        node({ id: 'c', type: 'code', params: { code: 'return { total: String(Number(dv.a) + 2) };' }, edges: [{ target: 'z', condition: 'always' }] }),
        node({ id: 'z', type: 'extraction', prompt: 'report the total' }),
      ],
    };
    respond = (req) =>
      req.messages.some((m) => m.content.includes('code step returned'))
        ? { content: [{ type: 'text', text: 'total ready' }] }
        : { content: [{ type: 'tool_use', name: 'transition_flow', input: { next_node_id: 'c' } }, { type: 'text', text: 'on it' }] };
    const r = await runUserTurn(flow, { currentNodeId: 'g', collectedData: { a: '40' } }, [], 'go');
    expect(r.state.collectedData).toEqual({ a: '40', total: '42' });
    expect(lastUser()).toContain('code step returned {"total":"42"}');
  });

  it('a start code node feeds its output to the next turn and a failing script reports it', async () => {
    const ok = await runOpeningTurn({ startNodeId: 'c', nodes: [node({ id: 'c', type: 'code', params: { code: 'return { x: "1" };' } })] });
    expect(ok.state.collectedData.x).toBe('1');
    expect(lastUser()).toContain('code step returned {"x":"1"}');

    const bad = await runOpeningTurn({ startNodeId: 'c', nodes: [node({ id: 'c', type: 'code', params: { code: 'throw new Error("boom");' } })] });
    expect(bad.assistantMessages.length).toBe(1);
    expect(lastUser()).toContain('the code step failed');
  });

  it('stops a runaway script instead of hanging the chat', async () => {
    const t = Date.now();
    await runOpeningTurn({ startNodeId: 'c', nodes: [node({ id: 'c', type: 'code', params: { code: 'while(true){}' } })] });
    expect(lastUser()).toContain('the code step failed');
    expect(Date.now() - t).toBeLessThan(15000);
  }, 20000);
});

describe('extract_variable node', () => {
  it('extracts typed values from the conversation, never talks, and jumps to its first edge', async () => {
    respond = (req) =>
      req.tool_choice
        ? { content: [{ type: 'tool_use', name: 'record_variables', input: { name: 'Sam', party: 4, vip: null } }] }
        : { content: [{ type: 'text', text: 'Thanks Sam' }] };
    const flow = {
      startNodeId: 'g',
      nodes: [
        node({ id: 'g', type: 'greeting', edges: [{ target: 'e', condition: 'got details' }] }),
        node({ id: 'e', type: 'extract_variable', extract: { name: 'string', party: 'number', vip: 'boolean' }, edges: [{ target: 'z', condition: 'always' }] }),
        node({ id: 'z', type: 'extraction', prompt: 'confirm' }),
      ],
    };
    respond = (req) =>
      req.tool_choice
        ? { content: [{ type: 'tool_use', name: 'record_variables', input: { name: 'Sam', party: 4, vip: null } }] }
        : { content: [{ type: 'tool_use', name: 'transition_flow', input: { next_node_id: 'e' } }, { type: 'text', text: 'one sec' }] };
    const r = await runUserTurn(flow, { currentNodeId: 'g', collectedData: {} }, [], "I'm Sam, party of 4");
    expect(r.state.collectedData).toEqual({ name: 'Sam', party: '4' }); // null skipped
    expect(r.state.currentNodeId).toBe('z'); // waits there for the visitor
    expect(r.assistantMessages).toEqual(['one sec']); // the extract node added no message of its own
  });
});

describe('stubbed side-effect nodes', () => {
  it.each(['sms', 'press_digit', 'payment', 'mcp'] as const)('%s runs as a no-op and says so', async (type) => {
    const r = await runOpeningTurn({ startNodeId: 's', nodes: [node({ id: 's', type })] });
    expect(lastUser()).toContain(`this "${type}" step is simulated`);
    expect(r.ended).toBe(false);
    expect(r.assistantMessages.length).toBe(1);
  });

  it('agent_transfer ends the session like transfer', async () => {
    const r = await runOpeningTurn({ startNodeId: 't', nodes: [node({ id: 't', type: 'agent_transfer' })] });
    expect(r.ended).toBe(true);
  });

  it('subflow_ref passes through to its first edge', async () => {
    const r = await runOpeningTurn({
      startNodeId: 'r',
      nodes: [node({ id: 'r', type: 'subflow_ref', edges: [{ target: 'n', condition: 'always' }] }), node({ id: 'n', type: 'greeting' })],
    });
    expect(r.state.currentNodeId).toBe('n');
  });
});
