import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ updateCalls: [] as unknown[], existingSettings: { subscription_status: 'active', tone: 'old' } as unknown, safeFetch: vi.fn(), insertCalls: 0, recordingUrl: '' }));

vi.mock('@/lib/authz', () => ({
  authorizeTenant: async () => ({ ok: true, principal: { via: 'session', userId: 'u1', tenantId: null } }),
  authorizeResource: async () => ({ ok: true, principal: { via: 'session', userId: 'u1', tenantId: null } }),
}));
vi.mock('@/lib/retell', () => ({ getRetellClient: () => ({ updateAgent: async () => {} }) }));
vi.mock('@/lib/safeFetch', async (orig) => ({ ...(await orig<typeof import('@/lib/safeFetch')>()), safeFetch: state.safeFetch }));
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b;
      b.update = (u: unknown) => { state.updateCalls.push({ table, u }); return b; };
      b.insert = () => { state.insertCalls++; return b; };
      const row = table === 'calldesk_tenants' ? { id: 't1', settings: state.existingSettings, retell_agent_id: null } : table === 'calldesk_call_logs' ? { recording_url: state.recordingUrl, recording_sid: null, voice_engine: 'retell' } : null;
      b.maybeSingle = async () => ({ data: row, error: null });
      b.single = async () => ({ data: row, error: null });
      (b as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve({ data: row, error: null }).then(res);
      return b;
    },
  }),
}));
import { PATCH } from '@/app/api/tenants/[id]/route';
import { POST as retellWebhook } from '@/app/api/webhooks/retell/route';
import { GET as recordingGet } from '@/app/api/calls/[id]/recording/route';
import { SsrfBlockedError } from '@/lib/safeFetch';
import { signRetellBody } from '@/lib/retellSignature';

const patch = (body: unknown) => PATCH(new NextRequest('https://x.test/api/tenants/t1', { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), { params: Promise.resolve({ id: 't1' }) });

beforeEach(() => { state.updateCalls.length = 0; state.insertCalls = 0; state.safeFetch.mockReset(); state.existingSettings = { subscription_status: 'active', tone: 'old' }; process.env.RETELL_API_KEY = 'retell-test-key'; });

describe('PATCH /api/tenants/[id]', () => {
  it('refuses to change ownership or Retell routing and does not touch the database', async () => {
    for (const body of [{ user_id: 'attacker' }, { retell_agent_id: 'x' }, { name: 'ok', retell_llm_id: 'y' }, { id: 'other' }]) {
      const res = await patch(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(state.updateCalls).toHaveLength(0);
  });
  it('saves allowed fields and keeps billing flags the server set', async () => {
    const res = await patch({ name: 'New name', settings: { tone: 'warm', subscription_status: 'canceled', default_payment_method: 'pm_fake' } });
    expect(res.status).toBe(200);
    expect(state.updateCalls).toEqual([{ table: 'calldesk_tenants', u: { name: 'New name', settings: { tone: 'warm', subscription_status: 'active' } } }]);
  });
});

describe('POST /api/webhooks/retell', () => {
  const body = JSON.stringify({ event: 'call_ended', call: { call_id: 'c1', agent_id: 'a1', recording_url: 'http://127.0.0.1:3000/x' } });
  const post = (headers: Record<string, string>) => retellWebhook(new NextRequest('https://x.test/api/webhooks/retell', { method: 'POST', body, headers }));
  it('rejects unsigned, badly signed and stale requests without reading or writing anything', async () => {
    expect((await post({})).status).toBe(401);
    expect((await post({ 'x-retell-signature': 'v=1,d=00' })).status).toBe(401);
    expect((await post({ 'x-retell-signature': signRetellBody(body, 'wrong-key', Date.now()) })).status).toBe(401);
    expect((await post({ 'x-retell-signature': signRetellBody(body, 'retell-test-key', Date.now() - 3600_000) })).status).toBe(401);
    expect(state.updateCalls).toHaveLength(0);
    expect(state.insertCalls).toBe(0);
  });
  it('rejects everything when no Retell key is configured (fail closed)', async () => {
    delete process.env.RETELL_API_KEY;
    expect((await post({ 'x-retell-signature': signRetellBody(body, '', Date.now()) })).status).toBe(401);
  });
  it('lets a correctly signed event through to normal processing', async () => {
    const res = await post({ 'x-retell-signature': signRetellBody(body, 'retell-test-key', Date.now()) });
    expect(res.status).not.toBe(401);
  });
});

describe('GET /api/calls/[id]/recording (retell branch)', () => {
  const get = () => recordingGet(new NextRequest('https://x.test/api/calls/c1/recording'), { params: Promise.resolve({ id: 'c1' }) });
  it('never fetches a non-https URL', async () => {
    state.recordingUrl = 'http://127.0.0.1:3000/secret';
    const res = await get();
    expect(res.status).toBe(404);
    expect(state.safeFetch).not.toHaveBeenCalled();
  });
  it('hides what a blocked internal address said', async () => {
    state.recordingUrl = 'https://metadata.internal/latest';
    state.safeFetch.mockRejectedValue(new SsrfBlockedError('Requests to private/local network addresses are not allowed'));
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.text()).not.toMatch(/private|internal|local/i);
  });
  it('refuses a response that is not audio', async () => {
    state.recordingUrl = 'https://example.com/r.wav';
    state.safeFetch.mockResolvedValue(new Response('<html>secret admin page</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const res = await get();
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('secret admin page');
  });
  it('streams real audio', async () => {
    state.recordingUrl = 'https://example.com/r.wav';
    state.safeFetch.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/wav' } }));
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/wav');
  });
});
