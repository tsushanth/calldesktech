import { describe, it, expect, vi, beforeAll } from 'vitest';
import { validateReply, sendManualReply, replyHtml } from '@/lib/outreach/manualSend';

const ENV = {
  OUTREACH_FROM_EMAIL: 'Calldesk <outreach@outreach.calldesk.tech>',
  OUTREACH_REPLYTO_EMAIL: 'outreach@calldesk.tech',
  OUTREACH_RESEND_API_KEY: 're_test',
  ADMIN_EMAILS: 'owner@example.com',
};
const GOOD = { to: 'Gianni@PurpleHorizons.io', subject: 'Re: Thanks for the call', body: 'Hi Gianni,\n\nThank you.\n\nThe Calldesk team' };

function fakeDb(suppressed = false) {
  const inserts: Record<string, unknown>[] = [];
  const db = {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: suppressed ? { email: 'x' } : null }) }) }),
      insert: async (row: Record<string, unknown>) => { if (table === 'calldesk_outreach_manual_sends') inserts.push(row); return { error: null }; },
    }),
  };
  return { db: db as never, inserts };
}

describe('validateReply', () => {
  it('lowercases the recipient and copies the owner by default', () => {
    const v = validateReply(GOOD, ENV);
    expect(v.ok && v.value.to).toBe('gianni@purplehorizons.io');
    expect(v.ok && v.value.bcc).toEqual([]); // adminEmails() reads process.env, not the injected env
  });
  it('uses OUTREACH_REPLY_BCC when set', () => {
    const v = validateReply(GOOD, { ...ENV, OUTREACH_REPLY_BCC: 'me@example.com' });
    expect(v.ok && v.value.bcc).toEqual(['me@example.com']);
  });
  it('rejects bad addresses, empty bodies, multi-line subjects and a bad brand', () => {
    expect(validateReply({ ...GOOD, to: 'a@b' }, ENV).ok).toBe(false);
    expect(validateReply({ ...GOOD, to: 'a@b.com, c@d.com' }, ENV).ok).toBe(false);
    expect(validateReply({ ...GOOD, body: '  ' }, ENV).ok).toBe(false);
    expect(validateReply({ ...GOOD, subject: 'a\nb' }, ENV).ok).toBe(false);
    expect(validateReply({ ...GOOD, brand: 'nope' as never }, ENV).ok).toBe(false);
  });
  it('refuses em dashes and other non-ASCII unless allowed', () => {
    const bad = validateReply({ ...GOOD, body: 'Thanks — talk soon' }, ENV);
    expect(bad.ok).toBe(false);
    expect(validateReply({ ...GOOD, body: 'Thanks — talk soon', allowNonAscii: true }, ENV).ok).toBe(true);
  });
  it('checks inReplyTo, leadId and the bcc list', () => {
    expect(validateReply({ ...GOOD, inReplyTo: 'abc' }, ENV).ok).toBe(false);
    expect(validateReply({ ...GOOD, inReplyTo: '<id1@mail.example.com>' }, ENV).ok).toBe(true);
    expect(validateReply({ ...GOOD, leadId: 'not-a-uuid' }, ENV).ok).toBe(false);
    expect(validateReply({ ...GOOD, bcc: ['a@b.com', 'c@d.com', 'e@f.com', 'g@h.com'] }, ENV).ok).toBe(false);
  });
});

describe('sendManualReply', () => {
  beforeAll(() => { process.env.UNSUBSCRIBE_SECRET = 'test-secret'; });
  it('sends from the outreach sender with reply-to, bcc and unsubscribe headers, then logs it', async () => {
    const { db, inserts } = fakeDb();
    const send = vi.fn(async () => ({ ok: true, id: 'resend-1' }));
    const r = await sendManualReply(db, { ...GOOD, bcc: ['owner@example.com'], inReplyTo: '<m1@host.com>' }, { env: ENV, send, sentBy: 'cron' });
    expect(r).toMatchObject({ ok: true, id: 'resend-1', replyTo: 'outreach@calldesk.tech' });
    const p = send.mock.calls[0][0] as Record<string, any>;
    expect(p.from).toBe(ENV.OUTREACH_FROM_EMAIL);
    expect(p.to).toBe('gianni@purplehorizons.io');
    expect(p.bcc).toEqual(['owner@example.com']);
    expect(p.apiKey).toBe('re_test');
    expect(p.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(p.headers['In-Reply-To']).toBe('<m1@host.com>');
    expect(inserts[0]).toMatchObject({ status: 'sent', resend_id: 'resend-1', to_email: 'gianni@purplehorizons.io', sent_by: 'cron' });
  });
  it('refuses a suppressed recipient and sends nothing', async () => {
    const { db, inserts } = fakeDb(true);
    const send = vi.fn();
    const r = await sendManualReply(db, GOOD, { env: ENV, send });
    expect(r.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });
  it('logs a failed send and reports the error', async () => {
    const { db, inserts } = fakeDb();
    const send = vi.fn(async () => ({ ok: false, error: 'Resend responded 422' }));
    const r = await sendManualReply(db, GOOD, { env: ENV, send });
    expect(r).toEqual({ ok: false, error: 'Resend responded 422' });
    expect(inserts[0]).toMatchObject({ status: 'failed', error: 'Resend responded 422' });
  });
  it('fails clearly when the sender is not configured', async () => {
    const { db } = fakeDb();
    const r = await sendManualReply(db, GOOD, { env: {}, send: vi.fn() });
    expect(r).toEqual({ ok: false, error: 'OUTREACH_FROM_EMAIL is not configured' });
  });
  it('escapes html in the body', () => {
    expect(replyHtml('<b>hi</b> & bye\nline2')).toContain('&lt;b&gt;hi&lt;/b&gt; &amp; bye<br>line2');
  });
});
