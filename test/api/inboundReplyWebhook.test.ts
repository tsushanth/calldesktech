import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { POST } from '@/app/api/webhooks/inbound-reply/route';

type Row = { data: unknown; error: unknown };

function makeSupabaseMock(queueByTable: Record<string, Row[]>, rpcResult?: Row) {
  return {
    from(table: string) {
      const queue = queueByTable[table] ?? [];
      const result = queue.shift() ?? { data: [], error: null };
      const chainMethods = ['select', 'eq', 'neq', 'update', 'delete', 'insert', 'order', 'limit', 'ilike', 'is'];
      const builder: Record<string, unknown> = {};
      for (const m of chainMethods) builder[m] = () => builder;
      builder.maybeSingle = async () => result;
      builder.single = async () => result;
      (builder as unknown as PromiseLike<unknown>).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return builder;
    },
    rpc(_name: string, _params?: Record<string, unknown>) {
      return Promise.resolve(rpcResult ?? { data: 1, error: null });
    },
  };
}

function makeRequest(body: unknown, authorization?: string) {
  return new NextRequest('https://example.com/api/webhooks/inbound-reply', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(body),
  });
}

const ORIGINAL_SECRET = process.env.WEBHOOK_INBOUND_REPLY_SECRET;

beforeEach(() => {
  vi.mocked(getSupabaseAdmin).mockReset();
  process.env.WEBHOOK_INBOUND_REPLY_SECRET = 'correct-secret';
});

afterEach(() => {
  process.env.WEBHOOK_INBOUND_REPLY_SECRET = ORIGINAL_SECRET;
});

it('rejects a request with no authorization header', async () => {
  const response = await POST(makeRequest({ email: 'a@b.com' }));
  expect(response.status).toBe(401);
});

it('rejects a request with the wrong bearer secret', async () => {
  const response = await POST(makeRequest({ email: 'a@b.com' }, 'Bearer wrong-secret'));
  expect(response.status).toBe(401);
});

it('rejects when the secret is not configured server-side at all (fails closed)', async () => {
  delete process.env.WEBHOOK_INBOUND_REPLY_SECRET;
  const response = await POST(makeRequest({ email: 'a@b.com' }, 'Bearer anything'));
  expect(response.status).toBe(401);
});

it('accepts a request with the correct bearer secret and marks the lead replied', async () => {
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    makeSupabaseMock({
      calldesk_outreach_leads: [{ data: [{ id: 'lead-1' }], error: null }],
    }) as never
  );

  const response = await POST(makeRequest({ email: 'a@b.com' }, 'Bearer correct-secret'));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body).toEqual({ matched: 1, confirmed: [] });
});

it('rejects a request missing the email field', async () => {
  const response = await POST(makeRequest({}, 'Bearer correct-secret'));
  expect(response.status).toBe(400);
});


it('confirms an unconfirmed contact-form lead from the company\'s own auto-reply email', async () => {
  const updates: unknown[] = [];
  const inserts: unknown[] = [];
  const leadRow = { id: 'lead-7', domain: 'getstream.io', signals: { formOutreach: { status: 'needs_manual', attempts: [{ at: new Date(Date.now() - 45_000).toISOString(), outcome: 'needs_manual', reason: 'unconfirmed' }] } } };
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'limit']) builder[m] = () => builder;
  builder.update = (u: unknown) => { updates.push(u); return builder; };
  builder.insert = (r: unknown) => { inserts.push(r); return Promise.resolve({ error: null }); };
  (builder as unknown as PromiseLike<unknown>).then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [leadRow], error: null }).then(resolve);
  vi.mocked(getSupabaseAdmin).mockReturnValue({ from: () => builder, rpc: () => Promise.resolve({ data: 0, error: null }) } as never);
  const response = await POST(makeRequest({ email: 'bounce@mail.example.net', fromHeader: 'Stream <hello@getstream.io>', subject: 'Thank you for contacting us!' }, 'Bearer correct-secret'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ matched: 0, confirmed: ['getstream.io'] });
  expect(updates).toHaveLength(1);
  expect((updates[0] as { signals: { formOutreach: { status: string } } }).signals.formOutreach.status).toBe('submitted');
  // and the confirmation is recorded for the outreach queue's Worker tab
  expect(inserts).toHaveLength(1);
  expect(inserts[0]).toMatchObject({ lead_id: 'lead-7', outcome: 'submitted', proof: 'email', domain: 'getstream.io' });
  expect(String((inserts[0] as { confirmed_by: string }).confirmed_by)).toContain('hello@getstream.io');
});

it('an older worker payload (email only) still works and confirms nothing', async () => {
  vi.mocked(getSupabaseAdmin).mockReturnValue(makeSupabaseMock({ calldesk_outreach_leads: [{ data: [], error: null }] }) as never);
  const response = await POST(makeRequest({ email: 'a@b.com' }, 'Bearer correct-secret'));
  expect(response.status).toBe(200);
  expect((await response.json()).confirmed).toEqual([]);
});
