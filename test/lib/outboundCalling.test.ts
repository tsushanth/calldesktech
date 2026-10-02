import { describe, it, expect } from 'vitest';
import {
  normalizeNanp,
  sipUser,
  buildDialTwiml,
  buildRejectTwiml,
  decideDial,
  parseTestNumbers,
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
    expect(x).toContain('>+14256284887</Number>');
    expect(x).toContain('statusCallbackEvent="answered completed"');
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
    expect(decideDial(base)).toEqual({ ok: true, to: '+14256284887', callerId: '+12395551212', isTest: false });
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

describe('test numbers', () => {
  it('parses a comma list of mixed formats and drops junk', () => {
    expect([...parseTestNumbers('+14256284887, (206) 555-0142 ,nope,911')].sort()).toEqual(['+12065550142', '+14256284887']);
    expect(parseTestNumbers(undefined).size).toBe(0);
    expect(parseTestNumbers('').size).toBe(0);
  });
  it('lets a test number through without a lead or do-not-call check, and marks it as a test', () => {
    const d = decideDial({ ...base, leadId: null, doNotCall: true, isTestNumber: true });
    expect(d).toEqual({ ok: true, to: '+14256284887', callerId: '+12395551212', isTest: true });
  });
  it('still refuses a test number for an unknown caller, a bad number or the daily cap', () => {
    expect(decideDial({ ...base, isTestNumber: true, caller: null }).ok).toBe(false);
    expect(decideDial({ ...base, isTestNumber: true, to: '911' }).ok).toBe(false);
    expect(decideDial({ ...base, isTestNumber: true, dialsToday: 400 }).ok).toBe(false);
  });
  it('real leads are not marked as tests', () => {
    expect(decideDial(base)).toMatchObject({ ok: true, isTest: false });
  });
});

describe('mapDialStatus', () => {
  it('marks a completed far-end leg as answered and final', () => {
    expect(mapDialStatus('completed')).toEqual({ status: 'completed', answered: true, final: true });
  });
  it('treats unanswered outcomes as final and not answered', () => {
    expect(mapDialStatus('no-answer')).toEqual({ status: 'no-answer', answered: false, final: true });
    expect(mapDialStatus('busy')).toEqual({ status: 'busy', answered: false, final: true });
    expect(mapDialStatus(undefined)).toEqual({ status: 'failed', answered: false, final: true });
  });
  it('records an answer as in progress, not final', () => {
    expect(mapDialStatus('in-progress')).toEqual({ status: 'answered', answered: true, final: false });
  });
  it('ignores ringing/queued noise', () => {
    expect(mapDialStatus('ringing')).toBeNull();
    expect(mapDialStatus('initiated')).toBeNull();
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
