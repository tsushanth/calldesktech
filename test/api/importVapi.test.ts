import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const auth = vi.fn();
vi.mock('@/lib/authz', () => ({ requireAuth: (...a: unknown[]) => auth(...a) }));
import { POST } from '@/app/api/agents/import-vapi/route';

const post = (body: unknown) => POST(new NextRequest('https://calldesk.tech/api/agents/import-vapi', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
const ASSISTANT = { firstMessage: 'Hello', model: { messages: [{ role: 'system', content: 'Be helpful.' }] } };

beforeEach(() => { auth.mockReset(); auth.mockResolvedValue({ ok: true }); });

describe('POST /api/agents/import-vapi', () => {
  it('requires a signed-in user', async () => {
    auth.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await post(ASSISTANT)).status).toBe(401);
  });
  it('converts a bare assistant object', async () => {
    const r = await post(ASSISTANT);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.startNodeId).toBe('main');
    expect(j.nodes[0].params.spokenMessage).toBe('Hello');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('accepts the pasted text as a string, including the { assistant, tools } form', async () => {
    const pasted = JSON.stringify({ assistant: { model: { messages: [{ role: 'system', content: 'Help.' }], toolIds: ['t1'] } }, tools: [{ id: 't1', type: 'endCall' }] });
    const j = await (await post({ assistant: pasted })).json();
    expect(j.nodes.some((n: { type: string }) => n.type === 'goodbye')).toBe(true);
  });
  it('returns 400 with a plain message for a bad paste', async () => {
    const r = await post({ assistant: '{oops' });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/not valid JSON/);
  });
  it('returns 400 when the body itself is not JSON', async () => {
    expect((await post('not json')).status).toBe(400);
  });
  it('returns 413 for an oversized body', async () => {
    expect((await post('x'.repeat(450_001))).status).toBe(413);
  });
});
