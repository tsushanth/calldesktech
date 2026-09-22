import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { POST } from '@/app/api/webhooks/inbound-reply/route';

type Row = { data: unknown; error: unknown };

function makeSupabaseMock(queueByTable: Record<string, Row[]>) {
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
  expect(body).toEqual({ matched: 1 });
});

it('rejects a request missing the email field', async () => {
  const response = await POST(makeRequest({}, 'Bearer correct-secret'));
  expect(response.status).toBe(400);
});
