import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'crypto';

type Opts = { body: string; headers: Record<string, string> };
const safeFetch = vi.fn(async (...args: [string, Opts]) => (void args, { ok: true, status: 200 }));
vi.mock('@/lib/safeFetch', () => ({ safeFetch: (u: string, o: Opts) => safeFetch(u, o), validateUrlShape: () => {} }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({}) }));

import { buildFlatPayload, parseWebhookFormat } from '@/lib/webhookFlat';
import { deliverWebhook, signWebhookPayload } from '@/lib/webhooks';

const data = {
  call_id: 'c1', tenant_id: 't', caller_phone: '+14155550100', to_number: '+14155550123', direction: 'outbound',
  duration_seconds: 42, outcome: 'answered', transcript: 'secret words', recording_url: 'https://x/r.mp3',
  analysis: { built_in: { call_summary: 'Booked a visit.' }, custom: { email: 'dana@example.com' } },
  started_at: '2026-01-01T00:00:00.000Z', ended_at: '2026-01-01T00:00:42.000Z',
  call_log_id: 'log-1', agent_name: 'Sam',
  variables: { first_name: 'Dana', last_name: 'Lee', 'Weird Key!': 'v', n: 3, nested: { a: 1 } },
};

describe('buildFlatPayload', () => {
  const p = buildFlatPayload('call.completed', '2026-01-01T00:01:00.000Z', data, 'https://calldesk.tech');
  it('has the documented stable keys, single level, no spaces in keys', () => {
    expect(p).toMatchObject({
      event: 'call.completed', phone: '+14155550123', name: 'Dana Lee', email: 'dana@example.com',
      summary: 'Booked a visit.', outcome: 'answered', duration_seconds: 42, direction: 'outbound', call_id: 'c1',
      transcript_url: 'https://calldesk.tech/dashboard/calls/log-1', agent_name: 'Sam',
      started_at: data.started_at, ended_at: data.ended_at, var_first_name: 'Dana', var_weird_key: 'v', var_n: '3',
    });
    for (const [k, v] of Object.entries(p)) {
      expect(k).not.toMatch(/\s/);
      expect(['string', 'number']).toContain(typeof v);
    }
    expect(p).not.toHaveProperty('var_nested');
  });
  it('never leaks transcript text or recording URL', () => {
    expect(JSON.stringify(p)).not.toContain('secret words');
    expect(JSON.stringify(p)).not.toContain('r.mp3');
  });
  it('inbound uses the caller as phone; omits unknown name/email; empty transcript_url without log id', () => {
    const q = buildFlatPayload('call.completed', 'x', { call_id: 'c2', direction: 'inbound', caller_phone: '(415) 555-0100', to_number: '+1999' }, 'https://calldesk.tech');
    expect(q.phone).toBe('(415) 555-0100'); // not normalizable to E.164, passed through as-is
    expect(q).not.toHaveProperty('name');
    expect(q).not.toHaveProperty('email');
    expect(q.transcript_url).toBe('');
    expect(q.summary).toBe('');
  });
  it('non-call events pass scalars only', () => {
    const q = buildFlatPayload('webhook.test', 'x', { message: 'hi', nested: { a: 1 }, n: 2 });
    expect(q).toEqual({ event: 'webhook.test', created_at: 'x', message: 'hi', n: 2 });
  });
  it('parseWebhookFormat', () => {
    expect(parseWebhookFormat('flat')).toBe('flat');
    expect(parseWebhookFormat('nested')).toBe('nested');
    expect(parseWebhookFormat('x')).toBeNull();
  });
});

describe('deliverWebhook', () => {
  afterEach(() => safeFetch.mockClear());
  const sent = () => safeFetch.mock.calls[0][1];

  it('default (no format) is the unchanged nested envelope', async () => {
    await deliverWebhook({ url: 'https://h/x', secret: 'whsec_a' }, 'call.completed', { a: 1 });
    const body = JSON.parse(sent().body);
    expect(Object.keys(body).sort()).toEqual(['created_at', 'data', 'event']);
    expect(body.data).toEqual({ a: 1 });
  });
  it('explicit nested equals default', async () => {
    await deliverWebhook({ url: 'https://h/x', secret: 'whsec_a', format: 'nested' }, 'call.completed', { a: 1 });
    expect(JSON.parse(sent().body).data).toEqual({ a: 1 });
  });
  it('flat: single level and signature header over the exact body, same headers', async () => {
    await deliverWebhook({ url: 'https://h/x', secret: 'whsec_a', format: 'flat' }, 'call.completed', data);
    const o = sent();
    const body = JSON.parse(o.body);
    expect(body.phone).toBe('+14155550123');
    expect(body).not.toHaveProperty('data');
    expect(o.headers['X-CallDesk-Signature']).toBe(`sha256=${crypto.createHmac('sha256', 'whsec_a').update(o.body).digest('hex')}`);
    expect(o.headers['X-CallDesk-Signature']).toBe(`sha256=${signWebhookPayload('whsec_a', o.body)}`);
    expect(o.headers['X-CallDesk-Event']).toBe('call.completed');
    expect(o.headers['Content-Type']).toBe('application/json');
  });
});
