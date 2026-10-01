import { describe, it, expect } from 'vitest';
import {
  normalizeNanp,
  sipUser,
  buildDialTwiml,
  buildRejectTwiml,
  decideDial,
  mapDialStatus,
  type DialDecisionInput,
} from '@/lib/outboundCalling';
import { verifyTwilioSignature } from '@/lib/webhookAuth';

describe('normalizeNanp', () => {
  it('accepts common US formats', () => {
    expect(normalizeNanp('(425) 628-4887')).toBe('+14256284887');
    expect(normalizeNanp('425-628-4887')).toBe('+14256284887');
    expect(normalizeNanp('+1 425 628 4887')).toBe('+14256284887');
    expect(normalizeNanp('14256284887')).toBe('+14256284887');
  });
  it('refuses anything that is not a normal US/Canada number', () => {
    expect(normalizeNanp('911')).toBeNull();
    expect(normalizeNanp('+442071838750')).toBeNull();
    expect(normalizeNanp('+19005551234')).toBeNull(); // premium area code
    expect(normalizeNanp('+10125551234')).toBeNull(); // area code cannot start with 0/1
    expect(normalizeNanp('+14251284887')).toBeNull(); // exchange cannot start with 0/1
    expect(normalizeNanp('')).toBeNull();
  });
});

describe('sipUser', () => {
  it('reads the user part of a SIP URI', () => {
    expect(sipUser('sip:mary@calldesk-out.sip.twilio.com')).toBe('mary');
    expect(sipUser('sip:+14256284887@calldesk-out.sip.twilio.com;user=phone')).toBe('+14256284887');
    expect(sipUser('<sip:mark@x.sip.twilio.com>')).toBe('mark');
  });
  it('returns null for something that is not a SIP URI', () => {
    expect(sipUser('+14256284887')).toBeNull();
    expect(sipUser('')).toBeNull();
  });
});

describe('TwiML', () => {
  it('builds a Dial with caller id, bridge-answer and an action url, escaped', () => {
    const x = buildDialTwiml({ callerId: '+12395551212', to: '+14256284887', actionUrl: 'https://x.test/s?a=1&b=2' });
    expect(x).toContain('callerId="+12395551212"');
    expect(x).toContain('answerOnBridge="true"');
    expect(x).toContain('action="https://x.test/s?a=1&amp;b=2"');
    expect(x).toContain('<Number>+14256284887</Number>');
  });
  it('escapes the spoken rejection', () => {
    expect(buildRejectTwiml('a <b> & c')).toContain('a &lt;b&gt; &amp; c');
  });
});

const base: DialDecisionInput = {
  sipUsername: 'mary',
  to: '(425) 628-4887',
  caller: { caller_id: '+12395551212', enabled: true },
  leadId: 'lead-1',
  doNotCall: false,
  requireLead: true,
  dialsToday: 10,
  maxDialsPerDay: 400,
};

describe('decideDial', () => {
  it('allows a valid call and dials the normalized number as the caller\'s number', () => {
    expect(decideDial(base)).toEqual({ ok: true, to: '+14256284887', callerId: '+12395551212' });
  });
  it.each([
    ['unknown caller', { caller: null }, 'unknown_or_disabled_caller'],
    ['disabled caller', { caller: { caller_id: '+1', enabled: false } }, 'unknown_or_disabled_caller'],
    ['no sip user', { sipUsername: null }, 'unknown_or_disabled_caller'],
    ['bad number', { to: '911' }, 'invalid_number'],
    ['do not call', { doNotCall: true }, 'do_not_call'],
    ['number not in the call list', { leadId: null }, 'not_in_call_list'],
    ['daily cap reached', { dialsToday: 400 }, 'daily_limit'],
  ])('refuses: %s', (_n, patch, reason) => {
    const d = decideDial({ ...base, ...patch } as DialDecisionInput);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe(reason);
  });
  it('lets a number outside the lead list through only when the gate is off', () => {
    expect(decideDial({ ...base, leadId: null, requireLead: false }).ok).toBe(true);
  });
});

describe('mapDialStatus', () => {
  it('marks only a completed far-end leg as answered', () => {
    expect(mapDialStatus('completed')).toEqual({ status: 'completed', answered: true });
    expect(mapDialStatus('no-answer')).toEqual({ status: 'no-answer', answered: false });
    expect(mapDialStatus('busy')).toEqual({ status: 'busy', answered: false });
    expect(mapDialStatus(undefined)).toEqual({ status: 'failed', answered: false });
  });
});

describe('verifyTwilioSignature with an explicit token', () => {
  // Reference vector from Twilio's webhook-security documentation.
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  const params = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };
  const sig = '0/KCTR6DLpKmkAf8muzZqo1nDgQ=';
  it('accepts the documented signature and rejects a tampered one', () => {
    expect(verifyTwilioSignature(url, params, sig, { authToken: '12345', failClosed: true }).ok).toBe(true);
    expect(verifyTwilioSignature(url, { ...params, To: '+18005550000' }, sig, { authToken: '12345', failClosed: true }).ok).toBe(false);
  });
  it('fails closed when no token is available and failClosed is set', () => {
    const prev = process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_AUTH_TOKEN;
    try {
      expect(verifyTwilioSignature(url, params, sig, { failClosed: true }).ok).toBe(false);
      // original behavior unchanged without the option
      expect(verifyTwilioSignature(url, params, sig).ok).toBe(true);
    } finally {
      if (prev !== undefined) process.env.TWILIO_AUTH_TOKEN = prev;
    }
  });
});
