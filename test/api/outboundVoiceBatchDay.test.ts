import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// The dial gate must look the number up on the same batch day as the caller's list for the whole 5-11 PM Pacific shift.
let batchDates: string[] = [];
function builder(table: string) {
  const f: Record<string, unknown> = {};
  const b: Record<string, unknown> = {
    select: () => b, eq: (k: string, v: unknown) => { f[k] = v; if (table === 'calldesk_call_batches' && k === 'batch_date') batchDates.push(String(v)); return b; }, neq: () => b, gte: () => b,
    insert: async () => ({ data: null, error: null }),
    maybeSingle: async () => {
      if (table === 'calldesk_outbound_callers') return { data: { caller_id: '+15106626957', enabled: true } };
      if (table === 'calldesk_call_batches') return f.batch_date === '2026-10-14' ? { data: { lead_id: 'l', state: 'AU-SYD' } } : { data: null };
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

const dial = async (typed: string) => {
  const body = new URLSearchParams({ CallSid: 'CA1', From: 'sip:mark@calldesk.sip.twilio.com', To: `sip:${typed}@calldesk.sip.twilio.com` });
  const xml = await (await POST(new NextRequest('https://example.com/x', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }))).text();
  return /<Number[^>]*>([^<]+)<\/Number>/.exec(xml)?.[1] ?? null;
};
beforeEach(() => { batchDates = []; vi.useFakeTimers(); vi.stubEnv('INTL_CALL_COUNTRIES', 'NZ,AU'); vi.stubEnv('OUTBOUND_REQUIRE_LEAD', 'true'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('dial gate batch day across a Manila-hours shift', () => {
  // 5:05 PM, 8:55 PM, 9:05 PM (the old midnight-Eastern rollover) and 10:55 PM Pacific on Wednesday Oct 14, 2026
  for (const iso of ['2026-10-15T00:05:00Z', '2026-10-15T03:55:00Z', '2026-10-15T04:05:00Z', '2026-10-15T05:55:00Z']) {
    it(`finds the Oct 14 list at ${iso}`, async () => {
      vi.setSystemTime(new Date(iso));
      expect(await dial('+61290737841')).toBe('+61290737841');
      expect(new Set(batchDates)).toEqual(new Set(['2026-10-14']));
    });
  }
  it('uses the next list once the next shift starts (Thursday 5:05 PM Pacific)', async () => {
    vi.setSystemTime(new Date('2026-10-16T00:05:00Z'));
    expect(await dial('+61290737841')).toBeNull(); // Oct 15's list does not hold this number
    expect(new Set(batchDates)).toEqual(new Set(['2026-10-15']));
  });
});
