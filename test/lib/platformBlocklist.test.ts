import { describe, it, expect } from 'vitest';
import { isPlatformDomain } from '@/lib/outreach/platformBlocklist';

describe('isPlatformDomain', () => {
  it('matches domains, subdomains, URLs and emails of the blocked platforms', () => {
    expect(isPlatformDomain('vapi.ai')).toBe(true);
    expect(isPlatformDomain('www.retellai.com')).toBe(true);
    expect(isPlatformDomain('https://docs.vapi.ai/start')).toBe(true);
    expect(isPlatformDomain('partners@bland.ai')).toBe(true);
    expect(isPlatformDomain('Hello@Daily.co')).toBe(true);
  });
  it('does not match look-alikes, agencies or empty input', () => {
    expect(isPlatformDomain('notvapi.ai')).toBe(false);
    expect(isPlatformDomain('vapi.ai.example.com')).toBe(false);
    expect(isPlatformDomain('dailyco.com')).toBe(false);
    expect(isPlatformDomain('dialzara.com')).toBe(false);
    expect(isPlatformDomain(null)).toBe(false);
    expect(isPlatformDomain('')).toBe(false);
  });
});
