import { describe, it, expect, vi, beforeAll } from 'vitest';
import { renderProposal } from '@/lib/outreach/proposalEmail';
import { sendManualReply } from '@/lib/outreach/manualSend';

beforeAll(() => { vi.stubEnv('UNSUBSCRIBE_SECRET', 'test-secret'); });

const ADDR = '123 Example St, Seattle, WA 98101';
const base = { kind: 'partner' as const, firstName: 'Rashid', context: "Thanks for taking our colleague Mark's call today." };

describe('renderProposal', () => {
  it('partner: has the offer, the speech-API block, the footer and no non-ASCII text', () => {
    const r = renderProposal({ ...base, bookingUrl: 'https://cal.com/calldesk/demo' }, 'a@b.com', ADDR);
    expect(r.text).toContain('Hi Rashid,');
    expect(r.text).toContain('20% revenue share');
    expect(r.text).toContain('$0.0655');
    expect(r.text).toContain('https://cal.com/calldesk/demo');
    expect(r.text).toContain(ADDR);
    expect(r.text).toMatch(/Unsubscribe: https?:\/\//);
    expect(r.text).not.toMatch(/[^\x09\x0A\x20-\x7E]/);
    expect(r.html).toContain('href="https://cal.com/calldesk/demo"');
    expect(r.html).toContain('Book a 15-minute demo');
    expect(r.html).toContain('<a href="https://calldesk.tech"');
    expect(r.text).toContain('Calldesk (https://calldesk.tech)');
  });
  it('without a booking link it asks for times instead', () => {
    const r = renderProposal(base, 'a@b.com', ADDR);
    expect(r.text).toContain('Reply with two or three times');
    expect(r.html).not.toContain('Book a 15-minute demo');
  });
  it('direct: no partner terms and no speech API; mentions the trial cap', () => {
    const r = renderProposal({ kind: 'direct', context: 'Thank you for speaking with our team.' }, 'a@b.com', ADDR);
    expect(r.text).toContain('Hi,');
    expect(r.text).toContain('50 minutes');
    expect(r.text).not.toContain('revenue share');
    expect(r.text).not.toContain('readaloudai.org speech API');
  });
  it('partner can skip the speech API', () => {
    expect(renderProposal({ ...base, includeSpeechApi: false }, 'a@b.com', ADDR).text).not.toContain('$0.0655');
  });
  it('escapes HTML in names and context', () => {
    const r = renderProposal({ ...base, firstName: '<b>X</b>', context: 'a & b' }, 'a@b.com', ADDR);
    expect(r.html).not.toContain('<b>X</b>');
    expect(r.html).toContain('a &amp; b');
  });
});

describe('sendManualReply with a proposal', () => {
  const ENV = { OUTREACH_FROM_EMAIL: 'Calldesk <o@x.com>', OUTREACH_REPLYTO_EMAIL: 'o@calldesk.tech', OUTREACH_POSTAL_ADDRESS: ADDR, ADMIN_EMAILS: 'me@example.com' };
  const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }), insert: async () => ({ error: null }) }) } as never;
  it('sends the rendered html and text', async () => {
    const send = vi.fn(async () => ({ ok: true, id: 'r1' }));
    const res = await sendManualReply(db, { to: 'a@b.com', subject: 'Details', proposal: base }, { env: ENV, send });
    expect(res.ok).toBe(true);
    const p = send.mock.calls[0][0] as { html: string; text: string };
    expect(p.html).toContain('<table');
    expect(p.text).toContain('Hi Rashid,');
  });
  it('refuses without a postal address, with the readaloud brand, or with a bad booking link', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    expect((await sendManualReply(db, { to: 'a@b.com', subject: 's', proposal: base }, { env: { ...ENV, OUTREACH_POSTAL_ADDRESS: '' }, send })).ok).toBe(false);
    expect((await sendManualReply(db, { to: 'a@b.com', subject: 's', brand: 'readaloud', proposal: base }, { env: ENV, send })).ok).toBe(false);
    expect((await sendManualReply(db, { to: 'a@b.com', subject: 's', proposal: { ...base, bookingUrl: 'javascript:alert(1)' } }, { env: ENV, send })).ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
