import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => {
  process.env.ELEVENLABS_API_KEY = 'test-key';
  return { safeFetch: vi.fn(), inserted: [] as unknown[], fetchCalls: [] as { url: string; headers: Record<string, string> }[] };
});

vi.mock('@/lib/safeFetch', async (orig) => ({ ...(await orig<typeof import('@/lib/safeFetch')>()), safeFetch: h.safeFetch }));
vi.mock('@/lib/authz', () => ({
  authorizeTenant: async () => ({ ok: true, principal: { via: 'session', userId: 'u1', tenantId: null } }),
  requireTenantRole: async () => ({ ok: true, principal: { via: 'session', userId: 'u1', tenantId: null } }),
}));
vi.mock('@/lib/webhooks', async (orig) => ({ ...(await orig<typeof import('@/lib/webhooks')>()), generateWebhookSecret: () => 'whsec_test' }));
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b;
      b.insert = (row: unknown) => { h.inserted.push({ table, row }); return b; };
      const row = table === 'calldesk_phone_numbers' ? { tenant_id: 't1', id: 'p1' } : table === 'calldesk_sms_messages' ? { id: 'sms1' } : { id: 'w1', url: 'x', events: ['call.completed'] };
      b.maybeSingle = async () => ({ data: row, error: null });
      b.single = async () => ({ data: row, error: null });
      (b as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve({ data: row, error: null }).then(res);
      return b;
    },
  }),
}));

import { POST as createWebhook } from '@/app/api/tenants/[id]/webhooks/route';
import { POST as cloneVoice } from '@/app/api/tenants/[id]/voices/clone/route';
import { POST as inboundSms } from '@/app/api/webhooks/telnyx-sms/route';
import { deliverWebhook } from '@/lib/webhooks';
import { executeFunctionNode } from '@/lib/textFlowEngine';
import { checkDomainForRetell } from '@/lib/outreach/signals/techFingerprint';
import { SsrfBlockedError } from '@/lib/safeFetch';
import { internalBaseUrl } from '@/lib/internalBase';

const ctx = { params: Promise.resolve({ id: 't1' }) };
const json = (url: string, body: unknown) => new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => { h.safeFetch.mockReset(); h.inserted.length = 0; h.fetchCalls.length = 0; });

describe('internalBaseUrl', () => {
  it('is local and fixed, with an explicit override', () => {
    delete process.env.INTERNAL_APP_BASE; delete process.env.PORT;
    expect(internalBaseUrl()).toBe('http://127.0.0.1:3000');
    process.env.PORT = '8080'; expect(internalBaseUrl()).toBe('http://127.0.0.1:8080');
    process.env.INTERNAL_APP_BASE = 'http://localhost:9000/'; expect(internalBaseUrl()).toBe('http://localhost:9000');
    delete process.env.INTERNAL_APP_BASE; delete process.env.PORT;
  });
});

describe('F6: the SMS trial forward never uses the Host header and sends the secret only to the local base', () => {
  it('forwards to the fixed local URL even when Host and X-Forwarded-Proto are attacker-controlled', async () => {
    process.env.TRIAL_ONBOARDING_NUMBER = '+12705609480';
    process.env.INTERNAL_WEBHOOK_SECRET = 'top-secret-internal';
    delete process.env.INTERNAL_APP_BASE; delete process.env.PORT;
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => { h.fetchCalls.push({ url: String(url), headers: (init?.headers || {}) as Record<string, string> }); return new Response('{}', { status: 200 }); }) as typeof fetch;
    try {
      const req = new NextRequest('https://calldesk.tech/api/webhooks/telnyx-sms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'attacker.example', 'x-forwarded-proto': 'http' },
        body: JSON.stringify({ data: { event_type: 'message.received', id: 'e1', payload: { to: [{ phone_number: '+12705609480' }], from: { phone_number: '+14155555678' }, text: 'hello', id: 'm1' } } }),
      });
      await inboundSms(req);
    } finally { globalThis.fetch = real; delete process.env.TRIAL_ONBOARDING_NUMBER; delete process.env.INTERNAL_WEBHOOK_SECRET; }
    const forward = h.fetchCalls.find((c) => c.url.includes('/api/webhooks/trial-sms'));
    expect(forward?.url).toBe('http://127.0.0.1:3000/api/webhooks/trial-sms');
    expect(h.fetchCalls.some((c) => c.url.includes('attacker.example'))).toBe(false);
    expect(JSON.stringify(forward?.headers)).toContain('top-secret-internal');
  });
});

describe('F3: tenant webhooks', () => {
  it('refuses to register a webhook that points inside the network', async () => {
    for (const url of ['http://127.0.0.1:3000/api/admin', 'http://localhost/hook', 'http://169.254.169.254/latest', 'http://svc.internal:4280/', 'http://user:pw@example.com/']) {
      const res = await createWebhook(json('https://x.test/api/tenants/t1/webhooks', { url, events: ['call.completed'] }), ctx);
      expect(res.status, url).toBe(400);
    }
    expect(h.inserted).toHaveLength(0);
  });
  it('still registers a normal public https endpoint', async () => {
    const res = await createWebhook(json('https://x.test/api/tenants/t1/webhooks', { url: 'https://hooks.example.com/calldesk', events: ['call.completed'] }), ctx);
    expect(res.status).toBe(201);
    expect(h.inserted).toHaveLength(1);
  });
  it('delivery re-checks the destination and fails safely for private URLs, without leaking why', async () => {
    h.safeFetch.mockRejectedValue(new SsrfBlockedError('Requests to private/local network addresses are not allowed'));
    const r = await deliverWebhook({ url: 'http://10.0.0.5/hook', secret: 's' }, 'call.completed', { a: 1 });
    expect(r.ok).toBe(false); expect(r.status).toBeNull();
    // delivery goes through safeFetch with the signed body and no redirects to our headers
    expect(h.safeFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, opts] = h.safeFetch.mock.calls[0];
    expect(calledUrl).toBe('http://10.0.0.5/hook');
    expect(opts.method).toBe('POST');
    expect(opts.headers['X-CallDesk-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
  it('reports a normal 2xx delivery as ok', async () => {
    h.safeFetch.mockResolvedValue(new Response('ok', { status: 200 }));
    expect(await deliverWebhook({ url: 'https://hooks.example.com/x', secret: 's' }, 'call.completed', {})).toEqual({ ok: true, status: 200 });
  });
});

describe('F4: function nodes in the text chat engine', () => {
  const node = { id: 'n', type: 'function', function: 'lookup', params: { webhookUrl: 'http://169.254.169.254/' } } as never;
  it('tells the model the call failed, and never echoes anything, when the URL is blocked', async () => {
    h.safeFetch.mockRejectedValue(new SsrfBlockedError('Requests to private/local network addresses are not allowed'));
    const history: { role: string; content: string }[] = [];
    await executeFunctionNode(node, { a: '1' }, history as never);
    expect(history).toHaveLength(1);
    expect(history[0].content).toMatch(/failed/);
    expect(history[0].content).not.toMatch(/private|169\.254/);
  });
  it('passes a normal JSON reply to the model', async () => {
    h.safeFetch.mockResolvedValue(new Response(JSON.stringify({ slots: ['10am'] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const history: { role: string; content: string }[] = [];
    await executeFunctionNode({ ...(node as object), params: { webhookUrl: 'https://api.example.com/x' } } as never, {}, history as never);
    expect(history[0].content).toContain('10am');
  });
});

describe('F5: voice clone sample download', () => {
  const clone = (sampleUrl: string) => cloneVoice(json('https://x.test/api/tenants/t1/voices/clone', { name: 'Voice', sampleUrl }), ctx);
  it('refuses private destinations with a generic message', async () => {
    h.safeFetch.mockRejectedValue(new SsrfBlockedError('Requests to private/local network addresses are not allowed'));
    const res = await clone('http://127.0.0.1:3000/x');
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(JSON.stringify({ error: 'That sample URL is not allowed' }));
  });
  it('refuses a non-audio response and never forwards it anywhere', async () => {
    h.safeFetch.mockResolvedValue(new Response('<html>' + 'x'.repeat(5000) + '</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const real = globalThis.fetch; const calls: string[] = [];
    globalThis.fetch = (async (u: string | URL | Request) => { calls.push(String(u)); return new Response('{}'); }) as typeof fetch;
    try {
      const res = await clone('https://example.com/page');
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('audio file');
    } finally { globalThis.fetch = real; }
    expect(calls.some((u) => u.includes('elevenlabs'))).toBe(false);
  });
  it('hides fetch error details from the caller', async () => {
    h.safeFetch.mockRejectedValue(new Error('connect ECONNREFUSED 10.1.2.3:6379'));
    const res = await clone('https://example.com/a.mp3');
    expect(res.status).toBe(400);
    expect(await res.text()).not.toMatch(/ECONNREFUSED|10\.1\.2\.3/);
  });
});

describe('F7: outreach tech fingerprint', () => {
  it('skips a lead whose website points inside the network', async () => {
    h.safeFetch.mockRejectedValue(new SsrfBlockedError('blocked'));
    expect(await checkDomainForRetell('internal.company.test', 'X')).toBeNull();
  });
  it('still detects the marker on a public page', async () => {
    h.safeFetch.mockResolvedValue(new Response('<script src="https://cdn.retellai.com/sdk.js"></script>', { status: 200 }));
    const s = await checkDomainForRetell('acme.example', 'Acme');
    expect(s?.detail).toContain('retellai.com');
  });
});
