import { describe, it, expect } from 'vitest';
import {
  formatPhoneDisplay,
  formatPhoneE164,
  isValidUSPhone,
  isValidEmail,
  formatDuration,
} from '@/lib/utils';

describe('formatPhoneDisplay', () => {
  it('formats a 10-digit number', () => {
    expect(formatPhoneDisplay('5551234567')).toBe('(555) 123-4567');
  });
  it('formats an 11-digit +1 number using the last 10 digits', () => {
    expect(formatPhoneDisplay('+15551234567')).toBe('(555) 123-4567');
  });
  it('returns the input unchanged when it does not resolve to 10 digits', () => {
    expect(formatPhoneDisplay('12345')).toBe('12345');
  });
});

describe('formatPhoneE164', () => {
  it('adds +1 to a bare 10-digit number', () => {
    expect(formatPhoneE164('5551234567')).toBe('+15551234567');
  });
  it('adds + to an 11-digit number already starting with 1', () => {
    expect(formatPhoneE164('15551234567')).toBe('+15551234567');
  });
  it('falls back to prefixing + for anything else', () => {
    expect(formatPhoneE164('44123456789')).toBe('+44123456789');
  });
});

describe('isValidUSPhone', () => {
  it('accepts 10-digit numbers', () => {
    expect(isValidUSPhone('555-123-4567')).toBe(true);
  });
  it('accepts 11-digit numbers starting with 1', () => {
    expect(isValidUSPhone('1 555 123 4567')).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isValidUSPhone('12345')).toBe(false);
    expect(isValidUSPhone('25551234567')).toBe(false); // 11 digits, not starting with 1
  });
});

describe('isValidEmail', () => {
  it('accepts a normal address', () => {
    expect(isValidEmail('a@b.com')).toBe(true);
  });
  it('rejects addresses without an @ or domain dot', () => {
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
  it('trims surrounding whitespace before validating', () => {
    expect(isValidEmail('  a@b.com  ')).toBe(true);
  });
});

describe('formatDuration', () => {
  it('formats seconds as MM:SS, zero-padded', () => {
    expect(formatDuration(5)).toBe('00:05');
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(3600)).toBe('60:00');
  });
});
