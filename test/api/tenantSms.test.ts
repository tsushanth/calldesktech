import { it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/webhooks', () => ({ dispatchWebhookEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/smsProvider', () => ({ getSmsProvider: vi.fn() }));
vi.mock('@/lib/authz', () => ({ authorizeTenant: vi.fn() }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { dispatchWebhookEvent } from '@/lib/webhooks';
import { getSmsProvider } from '@/lib/smsProvider';
import { authorizeTenant } from '@/lib/authz';
import { POST, GET } from '@/app/api/tenants/[id]/sms/route';
import { GET as GET_CONVERSATIONS } from '@/app/api/tenants/[id]/sms/conversations/route';

type Row = { data: unknown; error: unknown };

function makeSupabaseMock(queueByTable: Record<string, Row[]>) {
  return {
    from(table: string) {
      const queue = queueByTable[table] ?? [];
      const result = queue.shift() ?? { data: null, error: null };
      const chainMethods = ['select', 'eq', 'neq', 'update', 'delete', 'insert', 'order', 'limit'];
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

function makeContext() {
  return { params: Promise.resolve({ id: 'tenant-1' }) };
}

function makePostRequest(body: unknown) {
  return new NextRequest('https://example.com/api/tenants/tenant-1/sms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(qs = '') {
  return new NextRequest(`https://example.com/api/tenants/tenant-1/sms${qs}`, { method: 'GET' });
}

beforeEach(() => {
  vi.mocked(getSupabaseAdmin).mockReset();
  vi.mocked(dispatchWebhookEvent).mockClear();
  vi.mocked(getSmsProvider).mockReset();
  vi.mocked(authorizeTenant).mockReset();
  vi.mocked(authorizeTenant).mockResolvedValue({ ok: true, tenantId: 'tenant-1' } as never);
});

it('GET returns the expected shape', async () => {
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    makeSupabaseMock({
      calldesk_sms_messages: [{ data: [{ id: 'sms-1', body: 'hi' }], error: null }],
    }) as never
  );

  const response = await GET(makeGetRequest(), makeContext());
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body).toEqual({ smsMessages: [{ id: 'sms-1', body: 'hi' }] });
});

it('POST validates required fields', async () => {
  const response = await POST(makePostRequest({ phoneNumberId: 'p1' }), makeContext());
  expect(response.status).toBe(400);
});

it('POST sends via the SMS provider and records the outbound message', async () => {
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    makeSupabaseMock({
      calldesk_phone_numbers: [{ data: { number: '+14155551234' }, error: null }],
      calldesk_sms_messages: [{ data: { id: 'sms-9', status: 'queued' }, error: null }],
    }) as never
  );
  const send = vi.fn().mockResolvedValue({ providerSid: 'SM1', status: 'queued' });
  vi.mocked(getSmsProvider).mockReturnValue({ send } as never);

  const response = await POST(
    makePostRequest({ phoneNumberId: 'p1', toNumber: '+14155559999', body: 'hello' }),
    makeContext()
  );
  const body = await response.json();

  expect(send).toHaveBeenCalledWith({ from: '+14155551234', to: '+14155559999', body: 'hello' });
  expect(response.status).toBe(201);
  expect(body).toEqual({ sms: { id: 'sms-9', status: 'queued' } });
  expect(dispatchWebhookEvent).toHaveBeenCalledWith('tenant-1', 'sms.sent', expect.any(Object));
});

it('a failed provider send is handled gracefully (route returns 502, not a crash)', async () => {
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    makeSupabaseMock({
      calldesk_phone_numbers: [{ data: { number: '+14155551234' }, error: null }],
      calldesk_sms_messages: [{ data: { id: 'sms-10', status: 'failed', error: 'carrier rejected' }, error: null }],
    }) as never
  );
  const send = vi.fn().mockResolvedValue({ providerSid: null, status: 'failed', error: 'carrier rejected' });
  vi.mocked(getSmsProvider).mockReturnValue({ send } as never);

  const response = await POST(
    makePostRequest({ phoneNumberId: 'p1', toNumber: '+14155559999', body: 'hello' }),
    makeContext()
  );
  const body = await response.json();

  // Route still inserts the record and dispatches sms.sent before checking
  // sendResult.error, then returns 502 with both the error and the sms row.
  expect(response.status).toBe(502);
  expect(body).toEqual({ error: 'carrier rejected', sms: { id: 'sms-10', status: 'failed', error: 'carrier rejected' } });
});

it('POST 404s when the phone number does not belong to the tenant', async () => {
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    makeSupabaseMock({
      calldesk_phone_numbers: [{ data: null, error: null }],
    }) as never
  );

  const response = await POST(
    makePostRequest({ phoneNumberId: 'p1', toNumber: '+14155559999', body: 'hello' }),
    makeContext()
  );
  expect(response.status).toBe(404);
});

it('conversations GET groups messages into threads by the other party number', async () => {
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    makeSupabaseMock({
      calldesk_sms_messages: [
        {
          data: [
            { direction: 'inbound', from_number: '+14155551111', to_number: '+14155550000', body: 'hi', created_at: '2026-01-02T00:00:00Z', read_at: null },
            { direction: 'outbound', from_number: '+14155550000', to_number: '+14155551111', body: 'hello back', created_at: '2026-01-01T00:00:00Z', read_at: null },
          ],
          error: null,
        },
      ],
    }) as never
  );

  const response = await GET_CONVERSATIONS(makeGetRequest(), makeContext());
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.conversations).toHaveLength(1);
  expect(body.conversations[0]).toMatchObject({ phoneNumber: '+14155551111', unreadCount: 1 });
});
