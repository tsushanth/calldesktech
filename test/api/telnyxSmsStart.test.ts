import { it, expect, vi, beforeEach, describe } from 'vitest';
import { NextRequest } from 'next/server';

const { send, clearOptOut, inserted } = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue({ status: 'sent', error: null }),
  clearOptOut: vi.fn().mockResolvedValue(undefined),
  inserted: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b;
      b.insert = (row: Record<string, unknown>) => { if (table === 'calldesk_sms_messages') inserted.push(row); return b; };
      const result = table === 'calldesk_phone_numbers' ? { data: { tenant_id: 't1', id: 'p1' }, error: null } : { data: { id: 'sms-1' }, error: null };
      b.maybeSingle = async () => result;
      b.single = async () => result;
      b.then = ((res: (v: unknown) => unknown) => Promise.resolve(result).then(res)) as never;
      return b;
    },
  }),
}));
vi.mock('@/lib/webhooks', () => ({ dispatchWebhookEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/smsProvider', () => ({ getSmsProvider: () => ({ send }) }));
vi.mock('@/lib/smsOptOut', async (orig) => ({ ...(await orig<typeof import('@/lib/smsOptOut')>()), clearOptOut, recordOptOut: vi.fn() }));

import { POST } from '@/app/api/webhooks/telnyx-sms/route';
import { isStartKeyword, OPT_IN_CONFIRMATION_TEXT } from '@/lib/smsOptOut';

const inbound = (text: string) => new NextRequest('https://example.com/api/webhooks/telnyx-sms', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ data: { event_type: 'message.received', id: 'e1', payload: { to: [{ phone_number: '+12705609480' }], from: { phone_number: '+14155555678' }, text, id: 'm1' } } }),
});

beforeEach(() => { send.mockClear(); clearOptOut.mockClear(); inserted.length = 0; delete process.env.TRIAL_ONBOARDING_NUMBER; });

describe('isStartKeyword', () => {
  it('matches only a whole-message START or UNSTOP', () => {
    for (const t of ['START', 'start', ' Start ', 'start.', 'UNSTOP']) expect(isStartKeyword(t)).toBe(true);
    for (const t of ['start my trial', 'yes', 'please start', '', 'restart']) expect(isStartKeyword(t)).toBe(false);
  });
});

describe('telnyx-sms START handling', () => {
  it('lifts the opt-out and replies with the registered consent confirmation', async () => {
    const res = await POST(inbound('START'));
    expect(res.status).toBe(200);
    expect(clearOptOut).toHaveBeenCalledWith('+14155555678');
    expect(send).toHaveBeenCalledWith({ from: '+12705609480', to: '+14155555678', body: OPT_IN_CONFIRMATION_TEXT });
    expect(OPT_IN_CONFIRMATION_TEXT).toMatch(/Message and data rates may apply/);
    expect(OPT_IN_CONFIRMATION_TEXT).toMatch(/STOP/);
    expect(OPT_IN_CONFIRMATION_TEXT).toMatch(/calldesk\.tech\/privacy/);
    expect(inserted.some((r) => r.direction === 'outbound' && r.body === OPT_IN_CONFIRMATION_TEXT)).toBe(true);
  });
  it('does nothing special for ordinary messages', async () => {
    await POST(inbound('what are your hours'));
    expect(send).not.toHaveBeenCalled();
    expect(clearOptOut).not.toHaveBeenCalled();
  });
});
