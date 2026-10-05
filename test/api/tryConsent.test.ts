import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, upserts: [] as { table: string; row: Record<string, unknown> }[], failTable: '' }));

vi.mock('@/lib/rateLimiter', () => ({ tryAcquireToken: vi.fn(async () => true) }));
vi.mock('@/lib/stripe', () => ({ getStripe: () => ({
  coupons: { retrieve: async () => ({}), create: async () => ({}) },
  promotionCodes: { create: async (p: { code: string }) => ({ code: p.code }) },
}) }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({ from: (table: string) => {
  const rows = () => (state.tables[table] ??= []);
  const filters: [string, unknown][] = [];
  const api = {
    select: () => api,
    eq: (c: string, v: unknown) => { filters.push([c, v]); return api; },
    maybeSingle: async () => ({ data: rows().find((r) => filters.every(([c, v]) => r[c] === v)) ?? null }),
    upsert: async (row: Record<string, unknown>) => { if (state.failTable === table) return { error: { message: 'boom' } }; state.upserts.push({ table, row }); rows().push(row); return { error: null }; },
    insert: async (row: Record<string, unknown>) => { if (state.failTable === table) return { error: { message: 'boom' } }; state.upserts.push({ table, row }); rows().push(row); return { error: null }; },
  };
  return api;
} }) }));

import { POST } from '@/app/api/try/route';
import { sampleTokenFor } from '@/lib/outreach/samples';
import { CONSENT_TEXT, CONSENT_VERSION, consentSha256 } from '@/lib/outreach/smsConsent';

const MSG = '11111111-1111-4111-8111-111111111111';
const req = (body: Record<string, unknown>) => new NextRequest('https://calldesk.tech/api/try', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7', 'user-agent': 'TestAgent/1', referer: 'https://mail.google.com/', 'accept-language': 'en-US' },
  body: JSON.stringify(body),
});
const good = (extra: Record<string, unknown> = {}) => ({ t: sampleTokenFor(MSG), phone: '(415) 555-0123', smsOptIn: true, consentVersion: CONSENT_VERSION, consentSha256: consentSha256(), ...extra });

beforeEach(() => {
  process.env.UNSUBSCRIBE_SECRET = 'test-secret'; process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  state.tables = { calldesk_outreach_messages: [{ id: MSG, lead_id: 'L1', product: 'calldesk:freight' }], sms_opt_outs: [] };
  state.upserts = []; state.failTable = '';
});

describe('POST /api/try audit trail', () => {
  it('records the exact wording shown, the form, and the request context in an append-only event', async () => {
    const res = await POST(req(good()));
    expect(res.status).toBe(200);
    const ev = state.upserts.find((u) => u.table === 'calldesk_sms_consent_events')!.row;
    expect(ev).toMatchObject({
      message_id: MSG, lead_id: 'L1', product: 'calldesk:freight', phone: '+14155550123', sms_opt_in: true, checkbox_default_checked: false,
      consent_version: CONSENT_VERSION, consent_text: CONSENT_TEXT, consent_sha256: consentSha256(), ip: '198.51.100.7', user_agent: 'TestAgent/1',
      referrer: 'https://mail.google.com/', accept_language: 'en-US',
    });
    expect((ev.form_copy as { consentLabel: string }).consentLabel).toBe(CONSENT_TEXT);
    expect(ev.page_url).toBe('https://calldesk.tech/try');
    expect(state.upserts.some((u) => u.table === 'calldesk_sms_consent_texts' && u.row.version === CONSENT_VERSION)).toBe(true);
  });
  it('stores the wording shown even when the box was NOT ticked', async () => {
    await POST(req(good({ smsOptIn: false })));
    const ev = state.upserts.find((u) => u.table === 'calldesk_sms_consent_events')!.row;
    expect(ev).toMatchObject({ sms_opt_in: false, consent_text: CONSENT_TEXT });
    const cur = state.upserts.find((u) => u.table === 'calldesk_sms_consents')!.row;
    expect(cur).toMatchObject({ sms_opt_in: false, sms_status: 'declined', consent_text: CONSENT_TEXT, consent_sha256: consentSha256() });
  });
  it('rejects a stale page and writes nothing', async () => {
    const res = await POST(req(good({ consentSha256: 'stale' })));
    expect(res.status).toBe(409);
    expect(state.upserts).toEqual([]);
  });
  it('rejects a request that does not say which wording it showed', async () => {
    const res = await POST(req({ t: sampleTokenFor(MSG), phone: '4155550123', smsOptIn: true }));
    expect(res.status).toBe(409);
  });
  it('does not record a consent it cannot prove: audit write failure fails the request and skips the consent row', async () => {
    state.failTable = 'calldesk_sms_consent_events';
    const res = await POST(req(good()));
    expect(res.status).toBe(500);
    expect(state.upserts.some((u) => u.table === 'calldesk_sms_consents')).toBe(false);
  });
  it('a STOP on file wins over the web opt-in but is still logged', async () => {
    state.tables.sms_opt_outs = [{ phone_number: '+14155550123' }];
    const res = await POST(req(good()));
    expect((await res.json()).suppressed).toBe(true);
    expect(state.upserts.find((u) => u.table === 'calldesk_sms_consents')!.row.sms_status).toBe('suppressed_stop_on_file');
    expect(state.upserts.some((u) => u.table === 'calldesk_sms_consent_events')).toBe(true);
  });
  it('a honeypot submission writes nothing', async () => {
    const res = await POST(req(good({ website: 'http://spam' })));
    expect(res.status).toBe(200);
    expect(state.upserts).toEqual([]);
  });
});
