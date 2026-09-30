import { describe, it, expect } from 'vitest';
import { extractPhones, pickBestPhone } from '@/lib/outreach/discovery/contactPages';

describe('extractPhones', () => {
  it('rejects unix timestamps and ids embedded in attributes/scripts', () => {
    const html = '<div data-ts="1790749805" data-id="3333333333"></div><script>var t=1674056648;</script>';
    expect(extractPhones(html)).toEqual([]);
  });
  it('does not take a slice of a longer digit run', () => {
    expect(extractPhones('<p>Order 991234567890123 ref</p>')).toEqual([]);
  });
  it('rejects 555 and repeated-digit placeholders', () => {
    expect(extractPhones('<p>Call (415) 555-0100 or 222-222-2222</p>')).toEqual([]);
  });
  it('finds visible numbers and tel links, normalised to 10 digits', () => {
    const html = '<a href="tel:+1-415-867-5309">x</a><p>Office: (212) 425-8150</p>';
    expect(extractPhones(html).sort()).toEqual(['2124258150', '4158675309']);
  });
  it('keeps explicit international numbers', () => {
    expect(extractPhones('<p>+47 915 24 700</p>')).toEqual(['+4791524700']);
  });
});

describe('pickBestPhone', () => {
  it('never falls back to a short fragment', () => {
    expect(pickBestPhone(['2124258150', '+4791524700'])).toBe('2124258150');
    expect(pickBestPhone([])).toBeNull();
  });
});
