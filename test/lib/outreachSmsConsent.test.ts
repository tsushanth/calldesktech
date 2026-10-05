import { describe, it, expect } from 'vitest';
import { CONSENT_TEXT, CONSENT_VERSION, FORM_COPY, consentSha256, csvEscape, formSha256, generateCouponCode, parseConsentBody, shownMatchesCurrent, smsStatusFor } from '@/lib/outreach/smsConsent';
import { renderOutreachEmail } from '@/lib/outreach/emailHtml';

describe('parseConsentBody', () => {
  it('normalizes a US number and reads the opt-in flag', () => {
    expect(parseConsentBody({ phone: '(415) 555-0123', smsOptIn: true, consentVersion: 'v', consentSha256: 'h' })).toEqual({ ok: true, phone: '+14155550123', smsOptIn: true, shownVersion: 'v', shownSha256: 'h' });
  });
  it('opt-in is true only for an explicit boolean true', () => {
    for (const v of ['true', 1, 'on', undefined, null]) expect(parseConsentBody({ phone: '4155550123', smsOptIn: v })).toMatchObject({ ok: true, smsOptIn: false });
  });
  it('rejects a bad number', () => {
    expect(parseConsentBody({ phone: '12345' })).toMatchObject({ ok: false, status: 400 });
    expect(parseConsentBody({ phone: '' })).toMatchObject({ ok: false });
  });
  it('flags a filled honeypot as a bot', () => {
    expect(parseConsentBody({ phone: '4155550123', website: 'http://spam' })).toEqual({ bot: true });
  });
});

describe('smsStatusFor', () => {
  it('declined without opt-in, pending with it, suppressed when STOP is on file', () => {
    expect(smsStatusFor(false, false)).toBe('declined');
    expect(smsStatusFor(false, true)).toBe('declined');
    expect(smsStatusFor(true, false)).toBe('pending_campaign');
    expect(smsStatusFor(true, true)).toBe('suppressed_stop_on_file');
  });
});

describe('consent wording and coupon code', () => {
  it('names the brand, rates, STOP and HELP, and says consent is not a condition', () => {
    expect(CONSENT_TEXT).toMatch(/Calldesk/); expect(CONSENT_TEXT).toMatch(/KREATIVEKOALASOLUTIONS LLC/);
    expect(CONSENT_TEXT).toMatch(/Message and data rates may apply/); expect(CONSENT_TEXT).toMatch(/STOP/); expect(CONSENT_TEXT).toMatch(/HELP/);
    expect(CONSENT_TEXT).toMatch(/not a condition/);
    expect(CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}-v\d+$/);
  });
  it('ASCII only (no em dashes)', () => { expect(/^[\x20-\x7E]*$/.test(CONSENT_TEXT)).toBe(true); });
  it('coupon codes have a fixed shape and no look-alike characters', () => {
    const code = generateCouponCode((n) => Uint8Array.from({ length: n }, (_, i) => i * 37));
    expect(code).toMatch(/^CALLDESK-[A-HJ-NP-Z2-9]{8}$/);
  });
  it('csvEscape quotes commas, quotes and newlines', () => {
    expect(csvEscape('a,b')).toBe('"a,b"'); expect(csvEscape('say "hi"')).toBe('"say ""hi"""'); expect(csvEscape(null)).toBe('');
  });
});

describe('trial link in the outreach email', () => {
  const base = { bodyText: 'Hello', footer: { text: '--', html: '<p>--</p>' } };
  it('is added with UTM tags when a tryUrl is given, in html and text', () => {
    const r = renderOutreachEmail({ ...base, tryUrl: 'https://calldesk.tech/try?t=abc', utm: { campaign: 'freight', step: 1 } });
    expect(r.html).toContain('Get a trial coupon'); expect(r.html).toContain('/try?t=abc'); expect(r.html).toContain('utm_campaign=freight');
    expect(r.text).toContain('Trial coupon: https://calldesk.tech/try?t=abc');
  });
  it('is absent when no tryUrl', () => {
    const r = renderOutreachEmail(base);
    expect(r.html).not.toContain('trial coupon'); expect(r.text).not.toContain('Trial coupon');
  });
});

describe('audit: what was shown is what is recorded', () => {
  it('the form copy carries the exact consent wording, unchecked by default', () => {
    expect(FORM_COPY.consentLabel).toBe(CONSENT_TEXT);
    expect(FORM_COPY.consentCheckboxDefaultChecked).toBe(false);
  });
  it('hashes are stable SHA-256 hex and change when the wording changes', () => {
    expect(consentSha256()).toMatch(/^[0-9a-f]{64}$/); expect(formSha256()).toMatch(/^[0-9a-f]{64}$/);
    expect(consentSha256()).toBe(consentSha256()); expect(consentSha256('other wording')).not.toBe(consentSha256());
  });
  it('a stale page (old version or hash) does not match the current wording', () => {
    expect(shownMatchesCurrent(CONSENT_VERSION, consentSha256())).toBe(true);
    expect(shownMatchesCurrent('2026-01-01-v0', consentSha256())).toBe(false);
    expect(shownMatchesCurrent(CONSENT_VERSION, consentSha256('old'))).toBe(false);
    expect(shownMatchesCurrent('', '')).toBe(false);
  });
});
