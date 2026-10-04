import { describe, it, expect } from 'vitest';
import { correctEmailTypo, preDraftEmailCheck } from '@/lib/outreach/emailTypo';
import type { Resolver } from '@/lib/outreach/mxCheck';

const err = (code: string) => Object.assign(new Error(code), { code });
const up: Resolver = { resolveMx: async () => [{}], resolve4: async () => [], resolve6: async () => [] };
const down: Resolver = { resolveMx: async () => { throw err('ENOTFOUND'); }, resolve4: async () => { throw err('ENOTFOUND'); }, resolve6: async () => { throw err('ENOTFOUND'); } };

describe('correctEmailTypo', () => {
  it.each([
    ['a@hotmial.com', 'a@hotmail.com'],
    ['a@gmial.com', 'a@gmail.com'],
    ['a@gmai.com', 'a@gmail.com'],
    ['a@gmail.con', 'a@gmail.com'],
    ['a@yaho.com', 'a@yahoo.com'],
    ['a@yahooo.com', 'a@yahoo.com'],
    ['A@Outlok.com', 'a@outlook.com'],
    ['a@acme.con', 'a@acme.com'],
  ])('%s -> %s', (input, expected) => expect(correctEmailTypo(input)).toBe(expected));
  it('leaves real providers and real business domains alone', () => {
    for (const e of ['a@gmail.com', 'a@hotmail.com', 'info@amberinternational.co', 'x@trimbleenvironmental.com', 'info@mail.com']) {
      expect(correctEmailTypo(e)).toBeNull();
    }
  });
});

describe('preDraftEmailCheck', () => {
  it('fixes a typo and reports it', async () => {
    expect(await preDraftEmailCheck('hussien_130@hotmial.com', up)).toEqual({ ok: true, email: 'hussien_130@hotmail.com', corrected: true });
  });
  it('passes a clean address untouched', async () => {
    expect(await preDraftEmailCheck('info@acme.com', up)).toEqual({ ok: true, email: 'info@acme.com', corrected: false });
  });
  it('rejects bad syntax', async () => {
    expect((await preDraftEmailCheck('not-an-email', up)).ok).toBe(false);
  });
  it('rejects a domain with no mail server', async () => {
    expect(await preDraftEmailCheck('a@nope.example', down)).toEqual({ ok: false, reason: 'no-mail-server', email: 'a@nope.example' });
  });
});
