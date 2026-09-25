import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEmail = vi.fn(async (_a: unknown) => ({ ok: true, id: 'r1' }));
vi.mock('@/lib/email', () => ({ sendEmail: (a: unknown) => sendEmail(a) }));
const domainCanReceiveMail = vi.fn(async (_e: string) => true);
vi.mock('@/lib/outreach/mxCheck', () => ({ domainCanReceiveMail: (e: string) => domainCanReceiveMail(e) }));
const getPublishedSample = vi.fn();
vi.mock('@/lib/outreach/samples', async (orig) => ({ ...(await orig<typeof import('@/lib/outreach/samples')>()), getPublishedSample: (...a: unknown[]) => getPublishedSample(...a) }));

import { sendApprovedMessage, buildFooter } from '@/lib/outreach/sender';

const MSG_ID = '11111111-1111-4111-8111-111111111111';
function fakeSupabase(product: string, failVariant = false, step?: number, sentToday = 0) {
  const updates: unknown[] = [];
  const client = {
    from(table: string) {
      const q = {
        select: () => q, eq: () => q, gte: () => q, not: () => q, like: () => q, or: () => q,
        then: (res: (v: unknown) => unknown) => res({ count: sentToday }),
        maybeSingle: async () =>
          table === 'calldesk_outreach_messages' ? { data: { id: MSG_ID, status: 'draft', product, lead_id: 'l1', to_email: 'a@b.co', subject: 'S', body_text: 'Hi\n\nA & B', ...(step === undefined ? {} : { step }) }, error: null }
          : { data: null, error: null },
        update: (v: Record<string, unknown>) => {
          updates.push(v);
          return { eq: async () => ('variant' in v && failVariant ? { error: { message: 'column does not exist' } } : { error: null }) };
        },
      };
      return q;
    },
  };
  return { client: client as never, updates };
}

beforeEach(() => {
  sendEmail.mockClear(); getPublishedSample.mockReset(); domainCanReceiveMail.mockReset(); domainCanReceiveMail.mockResolvedValue(true); delete process.env.OUTREACH_DAILY_CAP;
  process.env.OUTREACH_FROM_EMAIL = 'x@send.calldesk.tech'; process.env.OUTREACH_POSTAL_ADDRESS = '1 Main St';
  process.env.UNSUBSCRIBE_SECRET = 'test-secret'; process.env.OUTREACH_SAMPLE_VARIANT = 'sample';
});

const sample = { id: 's1', product: 'calldesk:freight', title: 'Freight', disclosure: 'AI demo', audio_duration_sec: 92, transcript: [{ speaker: 'caller', text: 'hi' }, { speaker: 'agent', text: 'hello' }], snippet: null };

describe('sendApprovedMessage sample integration', () => {
  it('no sample: email identical to legacy output', async () => {
    getPublishedSample.mockResolvedValue(null);
    const { client } = fakeSupabase('calldesk:freight');
    await sendApprovedMessage(client, MSG_ID);
    const args = sendEmail.mock.calls[0][0] as { html: string; text: string };
    const f = buildFooter('a@b.co', '1 Main St');
    expect(args.html).toBe(`<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1d29;max-width:560px"><p style="margin:0 0 18px"><a href="https://calldesk.tech" style="color:#2563eb;font-weight:600;text-decoration:none">calldesk.tech</a></p><p style="margin:0 0 14px">Hi</p><p style="margin:0 0 14px">A &amp; B</p>${f.html}</div>`);
    expect(args.text).toBe(`https://calldesk.tech\n\nHi\n\nA & B${f.text}`);
  });

  it('sends RFC 8058 one-click unsubscribe headers pointing at the POST endpoint', async () => {
    getPublishedSample.mockResolvedValue(null);
    const { client } = fakeSupabase('calldesk:freight');
    await sendApprovedMessage(client, MSG_ID);
    const { headers } = sendEmail.mock.calls[0][0] as { headers: Record<string, string> };
    expect(headers['List-Unsubscribe']).toMatch(/^<https:\/\/[^>]+\/api\/unsubscribe\/[^>]+>$/);
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('blocks a calldesk send once the shared daily cap is reached and leaves the message unsent', async () => {
    process.env.OUTREACH_DAILY_CAP = '20';
    const { client, updates } = fakeSupabase('calldesk:freight', false, undefined, 20);
    const out = await sendApprovedMessage(client, MSG_ID);
    expect(out).toMatchObject({ ok: false });
    expect((out as { error: string }).error).toContain('Daily send cap reached (20 of 20)');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('sends when under the cap', async () => {
    process.env.OUTREACH_DAILY_CAP = '20';
    getPublishedSample.mockResolvedValue(null);
    const { client } = fakeSupabase('calldesk:freight', false, undefined, 19);
    expect(await sendApprovedMessage(client, MSG_ID)).toMatchObject({ ok: true });
  });

  it('enforces the shared cap on Kreative Koala apps too', async () => {
    process.env.OUTREACH_FROM_EMAIL_VOXKEY = 'k@send.kreativekoala.llc'; process.env.OUTREACH_POSTAL_ADDRESS_KK = '1 Main St'; process.env.OUTREACH_DAILY_CAP_KK = '5';
    getPublishedSample.mockResolvedValue(null);
    const over = await sendApprovedMessage(fakeSupabase('kreativekoala:voxkey', false, undefined, 5).client, MSG_ID);
    expect(over).toMatchObject({ ok: false });
    expect((over as { error: string }).error).toContain('Daily send cap reached (5 of 5)');
    expect(await sendApprovedMessage(fakeSupabase('kreativekoala:voxkey', false, undefined, 4).client, MSG_ID)).toMatchObject({ ok: true });
    delete process.env.OUTREACH_DAILY_CAP_KK;
  });

  it('passes the dedicated outreach API key for calldesk sends only', async () => {
    process.env.OUTREACH_RESEND_API_KEY = 're_outreach_test';
    getPublishedSample.mockResolvedValue(null);
    await sendApprovedMessage(fakeSupabase('calldesk:freight').client, MSG_ID);
    expect((sendEmail.mock.calls[0][0] as { apiKey?: string }).apiKey).toBe('re_outreach_test');
    sendEmail.mockClear();
    process.env.OUTREACH_FROM_EMAIL_VOXKEY = 'k@send.kreativekoala.llc'; process.env.OUTREACH_POSTAL_ADDRESS_KK = '1 Main St';
    await sendApprovedMessage(fakeSupabase('kreativekoala:voxkey').client, MSG_ID);
    expect((sendEmail.mock.calls[0][0] as { apiKey?: string }).apiKey).toBeUndefined();
    delete process.env.OUTREACH_RESEND_API_KEY;
  });

  it('replies go to OUTREACH_REPLYTO_EMAIL when set, so a From on a send-only subdomain still receives replies', async () => {
    process.env.OUTREACH_FROM_EMAIL = 'Calldesk <outreach@outreach.calldesk.tech>';
    process.env.OUTREACH_REPLYTO_EMAIL = 'outreach@calldesk.tech';
    getPublishedSample.mockResolvedValue(null);
    await sendApprovedMessage(fakeSupabase('calldesk:freight').client, MSG_ID);
    const args = sendEmail.mock.calls[0][0] as { from: string; replyTo: string };
    expect(args.from).toBe('Calldesk <outreach@outreach.calldesk.tech>');
    expect(args.replyTo).toBe('outreach@calldesk.tech');
    delete process.env.OUTREACH_REPLYTO_EMAIL;
  });

  it('readaloud sends from its own address, replies to its own inbox, and uses its own cap', async () => {
    process.env.OUTREACH_FROM_EMAIL_READALOUD = 'ReadAloud <hello@send.readaloudai.org>';
    process.env.OUTREACH_REPLYTO_EMAIL_READALOUD = 'hello@readaloudai.org';
    process.env.OUTREACH_POSTAL_ADDRESS_KK = '1 Main St'; process.env.OUTREACH_DAILY_CAP_READALOUD = '2';
    getPublishedSample.mockResolvedValue(null);
    expect(await sendApprovedMessage(fakeSupabase('readaloud', false, undefined, 2).client, MSG_ID)).toMatchObject({ ok: false });
    expect(await sendApprovedMessage(fakeSupabase('readaloud', false, undefined, 1).client, MSG_ID)).toMatchObject({ ok: true });
    const args = sendEmail.mock.calls[0][0] as { from: string; replyTo: string; html: string; apiKey?: string };
    expect(args.from).toBe('ReadAloud <hello@send.readaloudai.org>');
    expect(args.replyTo).toBe('hello@readaloudai.org');
    expect(args.html).toContain('readaloudai.org');
    expect(args.apiKey).toBeUndefined();
    delete process.env.OUTREACH_DAILY_CAP_READALOUD;
  });

  it('fails a message whose recipient domain cannot receive mail, without sending', async () => {
    domainCanReceiveMail.mockResolvedValue(false);
    const { client, updates } = fakeSupabase('calldesk:freight');
    const out = await sendApprovedMessage(client, MSG_ID);
    expect(out).toMatchObject({ ok: false });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(updates).toContainEqual({ status: 'failed', error: 'recipient domain has no mail server' });
  });

  it('lookup throwing still sends the plain email', async () => {
    getPublishedSample.mockRejectedValue(new Error('boom'));
    const { client } = fakeSupabase('calldesk:freight');
    const r = await sendApprovedMessage(client, MSG_ID);
    expect(r.ok).toBe(true);
    expect((sendEmail.mock.calls[0][0] as { html: string }).html).not.toContain('Sample call');
  });

  it('sample variant includes the card and link, records variant; missing columns do not fail the send', async () => {
    getPublishedSample.mockResolvedValue(sample);
    const { client, updates } = fakeSupabase('calldesk:freight', true);
    const r = await sendApprovedMessage(client, MSG_ID);
    expect(r.ok).toBe(true);
    const args = sendEmail.mock.calls[0][0] as { html: string; text: string };
    expect(args.html).toContain('/samples/freight?t=');
    expect(args.text).toContain('/samples/freight?t=');
    expect(args.text).toContain('1:32');
    expect(updates).toContainEqual({ variant: 'sample', sample_id: 's1' });
  });

  it('plain variant with a sample available sends no card', async () => {
    process.env.OUTREACH_SAMPLE_VARIANT = 'plain';
    getPublishedSample.mockResolvedValue(sample);
    const { client, updates } = fakeSupabase('calldesk:freight');
    await sendApprovedMessage(client, MSG_ID);
    expect((sendEmail.mock.calls[0][0] as { html: string }).html).not.toContain('Sample call');
    expect(updates).toContainEqual({ variant: 'plain', sample_id: null });
  });

  it('bare calldesk product never looks up a sample', async () => {
    const { client } = fakeSupabase('calldesk');
    await sendApprovedMessage(client, MSG_ID);
    expect(getPublishedSample).not.toHaveBeenCalled();
  });

  it('follow-ups (step > 1) also carry the sample card and record the variant', async () => {
    getPublishedSample.mockResolvedValue(sample);
    const { client, updates } = fakeSupabase('calldesk:freight', true, 2);
    const r = await sendApprovedMessage(client, MSG_ID);
    expect(r.ok).toBe(true);
    expect(getPublishedSample).toHaveBeenCalled();
    const args = sendEmail.mock.calls[0][0] as { html: string; text: string };
    expect(args.html).toContain('/samples/freight?t=');
    expect(updates).toContainEqual({ variant: 'sample', sample_id: 's1' });
  });
});
