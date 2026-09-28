import { it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/webhooks', () => ({ dispatchWebhookEvent: vi.fn().mockResolvedValue(undefined) }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { dispatchWebhookEvent } from '@/lib/webhooks';
import { POST } from '@/app/api/webhooks/telnyx-sms/route';

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

function makeJsonRequest(body: unknown) {
  return new NextRequest('https://example.com/api/webhooks/telnyx-sms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeFormRequest(params: Record<string, string>) {
  const body = new URLSearchParams(params).toString();
  return new NextRequest('https://example.com/api/webhooks/telnyx-sms', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

beforeEach(() => {
  vi.mocked(getSupabaseAdmin).mockReset();
  vi.mocked(dispatchWebhookEvent).mockClear();
  delete process.env.TRIAL_ONBOARDING_NUMBER;
});

it('parses a Telnyx v2 JSON payload (array `to`, object `from`) and inserts a message row', async () => {
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    makeSupabaseMock({
      calldesk_phone_numbers: [{ data: { tenant_id: 'tenant-1', id: 'phone-1' }, error: null }],
      calldesk_sms_messages: [{ data: { id: 'sms-1' }, error: null }],
    }) as never
  );

  const request = makeJsonRequest({
    data: {
      event_type: 'message.received',
      id: 'evt-1',
      payload: {
        to: [{ phone_number: '+14155551234' }],
        from: { phone_number: '+14155555678' },
        text: 'hello there',
        id: 'msg-1',
      },
    },
  });

  const response = await POST(request);
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body).toEqual({ received: true, id: 'sms-1' });
  expect(dispatchWebhookEvent).toHaveBeenCalledWith(
    'tenant-1',
    'sms.received',
    expect.objectContaining({ from: '+14155555678', to: '+14155551234', body: 'hello there' })
  );
});

it('parses a Twilio form-encoded POST and returns TwiML XML', async () => {
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    makeSupabaseMock({
      calldesk_phone_numbers: [{ data: { tenant_id: 'tenant-1', id: 'phone-1' }, error: null }],
      calldesk_sms_messages: [{ data: { id: 'sms-2' }, error: null }],
    }) as never
  );

  const request = makeFormRequest({
    From: '+14155555678',
    To: '4155551234',
    Body: 'hi from twilio',
    MessageSid: 'SM123',
  });

  const response = await POST(request);
  const text = await response.text();

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/xml');
  expect(text).toContain('<Response/>');
});

it('does not crash when the body is read twice: json() fails then clone().text() succeeds for Twilio form data', async () => {
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    makeSupabaseMock({
      calldesk_phone_numbers: [{ data: { tenant_id: 'tenant-1', id: 'phone-1' }, error: null }],
      calldesk_sms_messages: [{ data: { id: 'sms-3' }, error: null }],
    }) as never
  );

  // Form-encoded body is not valid JSON, so request.json() must fail and the
  // route must fall back to clone().text() without throwing.
  const request = makeFormRequest({
    From: '+14155555678',
    To: '4155551234',
    Body: 'plain text body, not json',
  });

  const response = await POST(request);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).toContain('<Response/>');
});
