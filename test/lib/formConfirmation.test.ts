import { describe, it, expect } from 'vitest';
import { addressOf, hostOf, hostsRelated, confirmableLeads, confirmedOutreach } from '@/lib/outreach/formConfirmation';

const attempt = (reason: string, at = '2026-10-08T20:51:41.478Z', outcome = 'needs_manual') => ({ at, outcome, reason });
const lead = (domain: string, over: Record<string, unknown> = {}) => ({
  id: `id-${domain}`,
  domain,
  signals: { formOutreach: { status: 'needs_manual', attempts: [attempt('unconfirmed')], ...over } },
});
const mail = (fromHeader: string, over: Record<string, unknown> = {}) => ({ from: 'bounce@mail.example.net', fromHeader, subject: 'Thank you for contacting us!', receivedAt: new Date('2026-10-08T20:52:24Z'), ...over });

describe('address and host parsing', () => {
  it('reads plain and display-name addresses', () => {
    expect(addressOf('hello@getstream.io')).toBe('hello@getstream.io');
    expect(addressOf('Stream Team <Hello@GetStream.io>')).toBe('hello@getstream.io');
    expect(addressOf('"Cody" <cody.miller@masterofcode.com>')).toBe('cody.miller@masterofcode.com');
    expect(addressOf('')).toBe('');
    expect(hostOf('hello@www.getstream.io')).toBe('getstream.io');
    expect(hostOf('nohost')).toBeNull();
  });
  it('relates a site to its subdomains in both directions, and nothing else', () => {
    expect(hostsRelated('getstream.io', 'mail.getstream.io')).toBe(true);
    expect(hostsRelated('agents.bubblyphone.com', 'bubblyphone.com')).toBe(true);
    expect(hostsRelated('getstream.io', 'notgetstream.io')).toBe(false);
    expect(hostsRelated('getstream.io', 'stream.io')).toBe(false);
    expect(hostsRelated('com', 'example.com')).toBe(false);
    expect(hostsRelated(null, 'example.com')).toBe(false);
  });
});

describe('confirmableLeads', () => {
  it('confirms an unconfirmed lead from its own auto-reply (the real Getstream case: reply 43 s after the attempt)', () => {
    const got = confirmableLeads([lead('getstream.io'), lead('other.com')], mail('Stream <hello@getstream.io>'));
    expect(got.map((l) => l.domain)).toEqual(['getstream.io']);
  });
  it('matches on the envelope sender too, when the header is missing', () => {
    expect(confirmableLeads([lead('getstream.io')], mail('', { from: 'bounces@eu.getstream.io', fromHeader: null }))).toHaveLength(1);
  });
  it('ignores leads that are not in the unconfirmed state', () => {
    expect(confirmableLeads([lead('getstream.io', { attempts: [attempt('captcha')] })], mail('hello@getstream.io'))).toHaveLength(0);
    expect(confirmableLeads([lead('getstream.io', { status: 'submitted' })], mail('hello@getstream.io'))).toHaveLength(0);
    expect(confirmableLeads([lead('getstream.io', { attempts: [] })], mail('hello@getstream.io'))).toHaveLength(0);
  });
  it('ignores mail from before the attempt (beyond a small slack) or days after it', () => {
    expect(confirmableLeads([lead('getstream.io')], mail('hello@getstream.io', { receivedAt: new Date('2026-10-08T20:40:00Z') }))).toHaveLength(0);
    expect(confirmableLeads([lead('getstream.io')], mail('hello@getstream.io', { receivedAt: new Date('2026-10-08T20:50:00Z') }))).toHaveLength(1); // within slack
    expect(confirmableLeads([lead('getstream.io')], mail('hello@getstream.io', { receivedAt: new Date('2026-10-13T20:52:00Z') }))).toHaveLength(0);
  });
  it('does not confirm from an unrelated sender', () => {
    expect(confirmableLeads([lead('getstream.io')], mail('news@somewhere-else.com', { from: 'a@b.org' }))).toHaveLength(0);
  });
});

describe('confirmedOutreach', () => {
  it('marks submitted, keeps the history, and records the evidence', () => {
    const fo = lead('getstream.io').signals.formOutreach;
    const out = confirmedOutreach(fo, mail('Stream <hello@getstream.io>'));
    expect(out.status).toBe('submitted');
    expect(out.submittedAt).toBe('2026-10-08T20:52:24.000Z');
    expect(out.confirmedBy).toContain('hello@getstream.io');
    expect(out.confirmedBy).toContain('Thank you for contacting us!');
    expect(out.attempts).toHaveLength(2);
    expect(out.attempts[0].reason).toBe('unconfirmed');
    expect(out.attempts[1]).toMatchObject({ outcome: 'submitted' });
  });
});
