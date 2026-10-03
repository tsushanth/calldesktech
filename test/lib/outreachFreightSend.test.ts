import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEmail = vi.fn(async (_a: unknown) => ({ ok: true, id: 'r1' }));
vi.mock('@/lib/email', () => ({ sendEmail: (a: unknown) => sendEmail(a) }));
vi.mock('@/lib/outreach/mxCheck', () => ({ domainCanReceiveMail: async () => true }));
const getPublishedSample = vi.fn();
vi.mock('@/lib/outreach/samples', async (orig) => ({ ...(await orig<typeof import('@/lib/outreach/samples')>()), getPublishedSample: (...a: unknown[]) => getPublishedSample(...a) }));

import { sendApprovedMessage } from '@/lib/outreach/sender';

const MSG_ID = '33333333-3333-4333-8333-333333333333';
function fake(product: string, lead: Record<string, unknown> | null, step = 1) {
  const updates: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      const q = {
        select: () => q, eq: () => q, gte: () => q, not: () => q, like: () => q, or: () => q,
        then: (res: (v: unknown) => unknown) => res({ count: 0 }),
        maybeSingle: async () => table === 'calldesk_outreach_messages'
          ? { data: { id: MSG_ID, status: 'approved', product, lead_id: 'l1', to_email: 'a@broker.co', subject: 'S', body_text: 'Hi\n\nThere', step }, error: null }
          : table === 'calldesk_outreach_leads' ? { data: lead, error: null } : { data: null, error: null },
        update: (v: Record<string, unknown>) => { updates.push(v); return { eq: async () => ({ error: null }) }; },
      };
      return q;
    },
  };
  return { client: client as never, updates };
}

const US_LEAD = { id: 'l1', region_blocked: false, signals: {}, source_key: 'freight:mc:443795', location: 'Cole Camp, MO' };
const sample = { id: 's1', product: 'calldesk:freight', title: 'Freight', disclosure: 'AI demo', audio_duration_sec: 92, transcript: [{ speaker: 'caller', text: 'hi' }, { speaker: 'agent', text: 'hello' }], snippet: null };
const params = (u: string) => Object.fromEntries(new URL(u.replace(/&amp;/g, '&')).searchParams);

beforeEach(() => {
  sendEmail.mockClear(); getPublishedSample.mockReset();
  process.env.OUTREACH_FROM_EMAIL = 'x@send.calldesk.tech'; process.env.OUTREACH_POSTAL_ADDRESS = '1 Main St';
  process.env.UNSUBSCRIBE_SECRET = 'test-secret'; process.env.OUTREACH_SAMPLE_VARIANT = 'sample';
  delete process.env.OUTREACH_DAILY_CAP; delete process.env.OUTREACH_DECK_LINK;
});

describe('freight sends: UTM tagging end to end', () => {
  it('tags the site, sample and deck links with the vertical and the step, keeps the token, leaves unsubscribe alone', async () => {
    getPublishedSample.mockResolvedValue(sample);
    await sendApprovedMessage(fake('calldesk:freight', US_LEAD, 2).client, MSG_ID);
    const { html, text } = sendEmail.mock.calls[0][0] as { html: string; text: string };
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !h.includes('/unsubscribe/'));
    console.log(hrefs); expect(hrefs.length).toBeGreaterThanOrEqual(3);
    for (const h of hrefs) expect(params(h)).toMatchObject({ utm_source: 'outreach', utm_medium: 'email', utm_campaign: 'freight', utm_content: 'step2' });
    const sampleHref = hrefs.find((h) => h.includes('/samples/freight'))!;
    expect(params(sampleHref).t).toMatch(/^[\w-]+\.[0-9a-f]{32}$/); // signed message token, not an address
    expect(html).not.toMatch(/utm_[a-z]+=[^&"]*(@|%40)/);

    expect(text).toMatch(/Listen to the full sample call: https:\/\/calldesk\.tech\/samples\/freight\?t=\S+&utm_source=outreach&utm_medium=email&utm_campaign=freight&utm_content=step2/);
    expect(html).toMatch(/href="https:\/\/calldesk\.tech\/unsubscribe\/[^"?&]+"/);
  });
  it('first email is utm_content=step1 and other verticals get their own campaign id', async () => {
    getPublishedSample.mockResolvedValue(null);
    await sendApprovedMessage(fake('calldesk:dental', { id: 'l1', region_blocked: false, signals: {} }, 1).client, MSG_ID);
    const { html } = sendEmail.mock.calls[0][0] as { html: string };
    expect(html).toContain('utm_campaign=dental&amp;utm_content=step1');
  });
});

describe('freight sends: US only', () => {
  it('refuses a non-US freight lead on every send path and marks the message failed', async () => {
    for (const lead of [
      { ...US_LEAD, source_key: 'freight:no:912345678', location: 'Oslo' },
      { ...US_LEAD, source_key: 'freight:gb-dvsa:OB1', location: 'Leeds' },
      { ...US_LEAD, signals: { intlHold: { country: 'NO' } } },
      null,
    ]) {
      sendEmail.mockClear();
      const f = fake('calldesk:freight', lead);
      const out = await sendApprovedMessage(f.client, MSG_ID);
      expect(out).toMatchObject({ ok: false });
      expect((out as { error: string }).error).toMatch(/US-only/);
      expect(f.updates).toEqual([{ status: 'failed', error: expect.stringMatching(/US-only/) }]);
      expect(sendEmail).not.toHaveBeenCalled();
    }
  });
  it('still sends a US broker, and does not apply the rule to other verticals', async () => {
    getPublishedSample.mockResolvedValue(null);
    expect(await sendApprovedMessage(fake('calldesk:freight', US_LEAD).client, MSG_ID)).toMatchObject({ ok: true });
    expect(await sendApprovedMessage(fake('calldesk:dental', { id: 'l1', region_blocked: false, signals: {}, source_key: 'dental:no:1' }).client, MSG_ID)).toMatchObject({ ok: true });
  });
});
