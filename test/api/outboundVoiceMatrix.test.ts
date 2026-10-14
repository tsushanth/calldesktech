import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { NextRequest } from 'next/server';

// Exhaustive check of what the line DIALS for every shape of number a caller can type, against a batch that
// holds only the number we intend. Synthetic numbers always run; set BATCH_FIXTURE=<json of {sip_username,phone}> to
// replay real lists (not committed: it holds third-party numbers).

let batch: Set<string> = new Set();
function builder(table: string) {
  const f: Record<string, unknown> = {};
  const b: Record<string, unknown> = {
    select: () => b, eq: (k: string, v: unknown) => { f[k] = v; return b; }, neq: () => b, gte: () => b,
    insert: async () => ({ data: null, error: null }),
    maybeSingle: async () => {
      if (table === 'calldesk_outbound_callers') return { data: { caller_id: '+15106626957', enabled: true } };
      if (table === 'calldesk_call_batches') return batch.has(String(f.phone)) ? { data: { lead_id: 'l', state: 'NZ-AKL' } } : { data: null };
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

const dialed = async (typed: string): Promise<string | null> => {
  const body = new URLSearchParams({ CallSid: 'CA1', From: 'sip:mary@calldesk.sip.twilio.com', To: `sip:${typed}@calldesk.sip.twilio.com` });
  const xml = await (await POST(new NextRequest('https://example.com/x', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }))).text();
  return /<Number[^>]*>([^<]+)<\/Number>/.exec(xml)?.[1] ?? null;
};
const shapes = (e164: string) => {
  const d = e164.slice(1);
  return [d, e164, `+${d.slice(0, 2)} ${d.slice(2)}`, e164.replace(/(\d{3})(?=\d)/g, '$1 ')];
};
beforeEach(() => { vi.stubEnv('INTL_CALL_COUNTRIES', 'NZ,SG'); vi.stubEnv('OUTBOUND_REQUIRE_LEAD', 'true'); });

function rnd(seed: number) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
const digits = (r: () => number, n: number) => Array.from({ length: n }, () => Math.floor(r() * 10)).join('');

describe('what the line dials, every shape', () => {
  it('NZ landlines in every area code (3,4,6,7,9), typed with or without the plus', async () => {
    const r = rnd(1);
    for (const area of ['3', '4', '6', '7', '9']) for (let i = 0; i < 40; i++) {
      const e = `+64${area}${digits(r, 7)}`; batch = new Set([e]);
      for (const t of shapes(e)) expect(await dialed(t)).toBe(e);
    }
  });
  it('NZ mobiles (+642x, 8 to 10 digits)', async () => {
    const r = rnd(2);
    for (let i = 0; i < 120; i++) { const e = `+642${digits(r, 7 + (i % 3))}`; batch = new Set([e]); for (const t of shapes(e)) expect(await dialed(t)).toBe(e); }
  });
  it('Singapore numbers', async () => {
    const r = rnd(3);
    for (let i = 0; i < 80; i++) { const e = `+65${['3', '6', '8', '9'][i % 4]}${digits(r, 7)}`; batch = new Set([e]); for (const t of shapes(e)) expect(await dialed(t)).toBe(e); }
  });
  it('US/Canada numbers, including area codes that look like NZ readings (641, 646, 647)', async () => {
    const r = rnd(4);
    for (const area of ['641', '646', '647', '512', '415', '212']) for (let i = 0; i < 25; i++) {
      const e = `+1${area}${2 + Math.floor(r() * 8)}${digits(r, 6)}`; batch = new Set([e]);
      expect(await dialed(e)).toBe(e);
      expect(await dialed(e.slice(2))).toBe(e); // 10 digits, no country code
      expect(await dialed(e.slice(1))).toBe(e); // 11 digits starting with 1
    }
  });
  it('a number in no batch is never dialed under any reading', async () => {
    const r = rnd(5); batch = new Set();
    for (let i = 0; i < 60; i++) { const e = `+64${['3', '4', '6', '7', '9', '21'][i % 6]}${digits(r, 7)}`; for (const t of shapes(e)) expect(await dialed(t)).toBeNull(); }
  });
  it('when the batch holds the US reading, the US number is dialed, not the NZ one', async () => {
    batch = new Set(['+16478349988']); expect(await dialed('6478349988')).toBe('+16478349988');
    batch = new Set(['+6478349988']); expect(await dialed('6478349988')).toBe('+6478349988');
  });
});

const fixture = process.env.BATCH_FIXTURE;
describe.skipIf(!fixture || !existsSync(fixture ?? ''))('replay of the real lists', () => {
  it('every number on the Oct 13 to 15 lists dials exactly itself, in every typed shape', async () => {
    const rows: Array<{ phone: string }> = JSON.parse(readFileSync(fixture as string, 'utf8'));
    let n = 0;
    for (const { phone } of rows) { batch = new Set([phone]); for (const t of shapes(phone)) { expect(await dialed(t)).toBe(phone); n++; } }
    expect(n).toBeGreaterThan(2000);
  });
});
