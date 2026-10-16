import { describe, it, expect, vi, beforeAll } from 'vitest';
import { renderProposal, withScheme, rich } from '@/lib/outreach/proposalEmail';
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
  it('renders extra sections and an offer call-out in text and HTML, ASCII only', () => {
    const r = renderProposal({ ...base, includeSpeechApi: false, sections: [{ heading: 'Your lead data', items: ['We only receive the lead you send us.', 'Row level security keeps accounts apart.'] }], offer: { heading: 'Free to try', text: 'One week, 50 minutes, no card.' } }, 'a@b.com', ADDR);
    expect(r.text).toContain('Your lead data:');
    expect(r.text).toContain('- We only receive the lead you send us.');
    expect(r.text).toContain('Free to try: One week, 50 minutes, no card.');
    expect(r.html).toContain('<b>Your lead data</b>');
    expect(r.html).toContain('Free to try');
    expect(r.text).not.toMatch(/[^\x09\x0A\x20-\x7E]/);
  });
  it('sections and offer are optional and escaped', () => {
    const r = renderProposal({ ...base, sections: [{ heading: '<b>x</b>', items: ['a & b'] }] }, 'a@b.com', ADDR);
    expect(r.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(r.html).toContain('a &amp; b');
    expect(renderProposal(base, 'a@b.com', ADDR).html).not.toContain('#eef6ff');
  });
  it('custom intro and bullets replace the defaults', () => {
    const r = renderProposal({ ...base, intro: 'The short version:', bullets: ['A speech API for your daily calls.'] }, 'a@b.com', ADDR);
    expect(r.text).toContain('The short version:');
    expect(r.text).toContain('- A speech API for your daily calls.');
    expect(r.text).not.toContain('20% revenue share');
    expect(r.html).toContain('A speech API for your daily calls.');
    expect(r.html).not.toContain('Inbound and outbound phone agents');
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
    expect((await sendManualReply(db, { to: 'a@b.com', subject: 's', proposal: { ...base, includePhone: 'no' as unknown as boolean } }, { env: ENV, send })).ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('contact line', () => {
  it('writes our US phone number with the country code by default', () => {
    const r = renderProposal(base, 'a@b.com', ADDR);
    expect(r.text).toContain('outreach@calldesk.tech or +1 425-628-4887.');
    expect(r.html).toContain('outreach@calldesk.tech or +1 425-628-4887.');
  });
  it('includePhone: false leaves the phone number out of both versions', () => {
    const r = renderProposal({ ...base, includePhone: false }, 'a@b.com', ADDR);
    expect(r.text).toContain('You can also reach us at outreach@calldesk.tech.');
    expect(r.html).toContain('You can also reach us at outreach@calldesk.tech.');
    expect(r.text).not.toContain('425');
    expect(r.html).not.toContain('425');
  });
});


describe('links in the message text', () => {
  it('withScheme gives a bare address on our domains with a path an https:// prefix, and leaves everything else alone', () => {
    expect(withScheme('Details at calldesk.tech/pricing.')).toBe('Details at https://calldesk.tech/pricing.');
    expect(withScheme('docs: readaloudai.org/integrations/vapi, then')).toBe('docs: https://readaloudai.org/integrations/vapi, then');
    expect(withScheme('already https://calldesk.tech/docs fine')).toBe('already https://calldesk.tech/docs fine');
    expect(withScheme('write to outreach@calldesk.tech')).toBe('write to outreach@calldesk.tech');
    expect(withScheme('we are Calldesk (calldesk.tech), hello')).toBe('we are Calldesk (calldesk.tech), hello');
    expect(withScheme('notcalldesk.tech/x and mycalldesk.tech/x')).toBe('notcalldesk.tech/x and mycalldesk.tech/x');
  });
  it('rich turns full and bare URLs into links, keeps sentence punctuation outside, and escapes the rest', () => {
    expect(rich('Docs at calldesk.tech/docs.')).toBe('Docs at <a href="https://calldesk.tech/docs" style="color:#2563eb">calldesk.tech/docs</a>.');
    expect(rich('See https://calldesk.tech/talk/abc_DEF-1 (try it)')).toBe('See <a href="https://calldesk.tech/talk/abc_DEF-1" style="color:#2563eb">https://calldesk.tech/talk/abc_DEF-1</a> (try it)');
    expect(rich('mail outreach@calldesk.tech')).toBe('mail outreach@calldesk.tech');
    expect(rich('R&D <b> "x"')).toBe('R&amp;D &lt;b&gt; &quot;x&quot;');
    expect(rich('no links here')).toBe('no links here');
  });
  it('a URL with a query string keeps it, escaped in the attribute', () => {
    expect(rich('go https://calldesk.tech/a?x=1&y=2.')).toBe('go <a href="https://calldesk.tech/a?x=1&amp;y=2" style="color:#2563eb">https://calldesk.tech/a?x=1&amp;y=2</a>.');
  });
  it('a rendered proposal links the docs bullet, the offer link and the context, in html and text', () => {
    const r = renderProposal({
      ...base, context: 'More at calldesk.tech/docs.', bullets: ['API docs at calldesk.tech/docs.', 'Partners: https://calldesk.tech/partners'],
      offer: { heading: 'Try it', text: 'In your browser: https://calldesk.tech/talk/xyz .' }, bookingUrl: 'https://cal.com/x/y',
    }, 'a@b.com', ADDR);
    expect(r.html).toContain('<a href="https://calldesk.tech/docs" style="color:#2563eb">calldesk.tech/docs</a>');
    expect(r.html).toContain('<a href="https://calldesk.tech/partners"');
    expect(r.html).toContain('<a href="https://calldesk.tech/talk/xyz"');
    expect(r.text).toContain('- API docs at https://calldesk.tech/docs.');
    expect(r.text).toContain('More at https://calldesk.tech/docs.');
    expect(r.text).not.toMatch(/[^\x09\x0A\x20-\x7E]/);
  });
  it('the default direct bullets link their pricing address too', () => {
    const r = renderProposal({ kind: 'direct', context: 'Thanks for the call.' }, 'a@b.com', ADDR);
    expect(r.html).toContain('<a href="https://calldesk.tech/pricing" style="color:#2563eb">calldesk.tech/pricing</a>');
  });
});
