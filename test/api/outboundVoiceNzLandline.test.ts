import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// A New Zealand landline (+64 3 476 2111) has the same 10 digits as a US number (+1 643 476 2111). The line must
// check today's batch against the reading that is in the batch AND dial that same reading.

const inserted: Array<Record<string, unknown>> = [];
let batchPhones: string[] = [];

function builder(table: string) {
  const f: Record<string, unknown> = {};
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (k: string, v: unknown) => { f[k] = v; return b; },
    neq: () => b,
    gte: () => b,
    insert: async (row: Record<string, unknown>) => { inserted.push(row); return { data: null, error: null }; },
    maybeSingle: async () => {
      if (table === 'calldesk_outbound_callers') return { data: { caller_id: '+15106626957', enabled: true } };
      if (table === 'calldesk_call_batches') return batchPhones.includes(String(f.phone)) ? { data: { lead_id: 'lead-1', state: 'NZ-AKL' } } : { data: null };
      return { data: null };
    },
    then: (res: (v: unknown) => unknown) => res({ data: [], count: 0, error: null }),
  };
  return b;
}
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/webhookAuth', () => ({ verifyTwilioSignature: () => ({ ok: true }) }));
vi.mock('@/lib/callingHours', async (orig) => ({ ...(await orig<typeof import('@/lib/callingHours')>()), checkCallingHours: () => ({ ok: true }) }));

import { POST } from '@/app/api/twilio/outbound-voice/route';

const call = (to: string) => {
  const body = new URLSearchParams({ CallSid: 'CA1', From: 'sip:mary@calldesk.sip.twilio.com', To: `sip:${to}@calldesk.sip.twilio.com` });
  return new NextRequest('https://example.com/api/twilio/outbound-voice', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
};

beforeEach(() => { inserted.length = 0; vi.stubEnv('INTL_CALL_COUNTRIES', 'NZ,SG'); vi.stubEnv('OUTBOUND_REQUIRE_LEAD', 'true'); });

describe('outbound-voice: NZ landline typed without a plus', () => {
  it('dials the +64 number that is in the batch, never the +1 reading', async () => {
    batchPhones = ['+6434762111'];
    const xml = await (await POST(call('6434762111'))).text();
    expect(xml).toContain('>+6434762111</Number>');
    expect(xml).not.toContain('+16434762111');
  });
  it('dials the +64 number when typed with the plus', async () => {
    batchPhones = ['+6434762111'];
    const xml = await (await POST(call('+6434762111'))).text();
    expect(xml).toContain('>+6434762111</Number>');
  });
  it('refuses a number that is in no batch under either reading', async () => {
    batchPhones = [];
    const xml = await (await POST(call('6434762111'))).text();
    expect(xml).not.toContain('<Number');
  });
  it('a real US number in the batch is still dialed as US', async () => {
    batchPhones = ['+15126086782'];
    const xml = await (await POST(call('5126086782'))).text();
    expect(xml).toContain('>+15126086782</Number>');
  });
});
