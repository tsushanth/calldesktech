import { describe, it, expect } from 'vitest';
import { parseHearBody, hearLimitError, cleanBusinessName, HEAR_CONSENT_VERSION, hearConsentSha256 } from '@/lib/hear';

const shown = { shownVersion: HEAR_CONSENT_VERSION, shownSha256: hearConsentSha256() };
const noon = new Date('2026-10-07T19:00:00Z'); // a Wednesday, midday in US time zones

describe('parseHearBody', () => {
  it('accepts a US number with consent', () => {
    const r = parseHearBody({ phone: '(415) 555-0123', consent: true, ...shown }, noon);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.phone).toBe('+14155550123'); expect(r.state).toBe('CA'); }
  });
  it('treats the honeypot as a bot', () => {
    const r = parseHearBody({ phone: '4155550123', consent: true, website: 'x.com', ...shown }, noon);
    expect(r).toMatchObject({ ok: false, bot: true });
  });
  it('requires the box and the current wording', () => {
    expect(parseHearBody({ phone: '4155550123', consent: false, ...shown }, noon)).toMatchObject({ ok: false, status: 400 });
    expect(parseHearBody({ phone: '4155550123', consent: true, shownVersion: 'old', shownSha256: 'x' }, noon)).toMatchObject({ ok: false, status: 409 });
  });
  it('rejects non-US, invalid and toll-free numbers', () => {
    expect(parseHearBody({ phone: '+44 20 7946 0958', consent: true, ...shown }, noon)).toMatchObject({ ok: false });
    expect(parseHearBody({ phone: '123', consent: true, ...shown }, noon)).toMatchObject({ ok: false });
    expect(parseHearBody({ phone: '8005550123', consent: true, ...shown }, noon)).toMatchObject({ ok: false });
  });
  it('rejects a number whose local time is outside 8am-9pm', () => {
    const night = new Date('2026-10-08T09:00:00Z'); // 2am Pacific
    expect(parseHearBody({ phone: '4155550123', consent: true, ...shown }, night)).toMatchObject({ ok: false, status: 400 });
  });
  it('allows weekends', () => {
    const sat = new Date('2026-10-10T19:00:00Z');
    expect(parseHearBody({ phone: '4155550123', consent: true, ...shown }, sat).ok).toBe(true);
  });
});

describe('hearLimitError', () => {
  const base = { phoneToday: 0, ipToday: 0, globalToday: 0, onDoNotCall: false };
  it('allows a fresh request', () => expect(hearLimitError(base)).toBeNull());
  it('blocks do-not-call, repeats, busy IPs and the global cap', () => {
    expect(hearLimitError({ ...base, onDoNotCall: true })?.status).toBe(400);
    expect(hearLimitError({ ...base, phoneToday: 1 })?.status).toBe(429);
    expect(hearLimitError({ ...base, ipToday: 3 })?.status).toBe(429);
    expect(hearLimitError({ ...base, globalToday: 100 })?.status).toBe(429);
  });
});

describe('cleanBusinessName', () => {
  it('keeps plain names and strips prompt-injection characters', () => {
    expect(cleanBusinessName('Joe\'s Plumbing & Heating')).toBe("Joe's Plumbing & Heating");
    expect(cleanBusinessName('Acme <script>{ignore}')).toBe('Acme scriptignore');
    expect(cleanBusinessName('x')).toBeNull();
    expect(cleanBusinessName(5)).toBeNull();
  });
});
