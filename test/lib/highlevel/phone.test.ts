import { describe, it, expect } from 'vitest';
import { normalizePhone, parseVariableLines } from '@/lib/highlevel/phone';

describe('normalizePhone', () => {
  it('handles the shapes HighLevel contacts have', () => {
    expect(normalizePhone('+14155550123')).toBe('+14155550123');
    expect(normalizePhone('(415) 555-0123')).toBe('+14155550123');
    expect(normalizePhone('415-555-0123')).toBe('+14155550123');
    expect(normalizePhone('1 415 555 0123')).toBe('+14155550123');
    expect(normalizePhone('  +61 412 345 678 ')).toBe('+61412345678');
    expect(normalizePhone('+64 21 123 4567')).toBe('+64211234567');
  });
  it('refuses what it would have to guess', () => {
    for (const v of ['', '   ', '12345', '0412345678', '0211234567', '1234567890', '4150550123', '14155550123 5', '+123', '+1234567890123456', null, undefined, 4155550123, 'abc']) expect(normalizePhone(v)).toBeNull();
  });
});

describe('parseVariableLines', () => {
  it('turns name=value lines into variables and skips empty values and blank lines', () => {
    expect(parseVariableLines('first_name=Sam\n\ncompany = Acme Co \nlast_name=\r\nnote=a=b')).toEqual({ ok: true, variables: { first_name: 'Sam', company: 'Acme Co', note: 'a=b' } });
  });
  it('is fine with nothing', () => {
    for (const v of [undefined, null, '', '\n\n', 'x=']) expect(parseVariableLines(v)).toEqual({ ok: true, variables: undefined });
  });
  it('names a bad line and rejects non-text', () => {
    expect(parseVariableLines('first_name=Sam\njust text')).toMatchObject({ ok: false, error: expect.stringContaining('just text') });
    expect(parseVariableLines('=nokey')).toMatchObject({ ok: false });
    expect(parseVariableLines({ a: 1 })).toMatchObject({ ok: false });
  });
});
