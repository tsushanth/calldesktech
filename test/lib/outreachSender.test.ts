import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEmail = vi.fn(async (_a: unknown) => ({ ok: true, id: 'r1' }));
vi.mock('@/lib/email', () => ({ sendEmail: (a: unknown) => sendEmail(a) }));
const getPublishedSample = vi.fn();
vi.mock('@/lib/outreach/samples', async (orig) => ({ ...(await orig<typeof import('@/lib/outreach/samples')>()), getPublishedSample: (...a: unknown[]) => getPublishedSample(...a) }));

import { sendApprovedMessage, buildFooter } from '@/lib/outreach/sender';

const MSG_ID = '11111111-1111-4111-8111-111111111111';
function fakeSupabase(product: string, failVariant = false, step?: number) {
  const updates: unknown[] = [];
  const client = {
    from(table: string) {
      const q = {
        select: () => q, eq: () => q,
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
  sendEmail.mockClear(); getPublishedSample.mockReset();
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
