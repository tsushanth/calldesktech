import { describe, it, expect } from 'vitest';
import { domainCanReceiveMail, type Resolver } from '@/lib/outreach/mxCheck';

const err = (code: string) => Object.assign(new Error(code), { code });
const resolver = (o: Partial<Record<'mx' | 'a' | 'aaaa', unknown[] | string>>): Resolver => {
  const f = (v: unknown[] | string | undefined) => async () => {
    if (typeof v === 'string') throw err(v);
    if (v === undefined) throw err('ENODATA');
    return v;
  };
  return { resolveMx: f(o.mx), resolve4: f(o.a), resolve6: f(o.aaaa) };
};

describe('domainCanReceiveMail', () => {
  it('true when the domain has an MX record', async () => {
    expect(await domainCanReceiveMail('a@x.com', resolver({ mx: [{ exchange: 'm', priority: 1 }] }))).toBe(true);
  });
  it('true via implicit MX (A record) when there is no MX', async () => {
    expect(await domainCanReceiveMail('a@x.com', resolver({ a: ['1.2.3.4'] }))).toBe(true);
  });
  it('false when the domain does not exist', async () => {
    expect(await domainCanReceiveMail('a@nope.invalid', resolver({ mx: 'ENOTFOUND', a: 'ENOTFOUND', aaaa: 'ENOTFOUND' }))).toBe(false);
  });
  it('false when there is no MX, A, or AAAA record', async () => {
    expect(await domainCanReceiveMail('a@x.com', resolver({}))).toBe(false);
  });
  it('true when DNS times out, so a flaky lookup never blocks a send', async () => {
    expect(await domainCanReceiveMail('a@x.com', resolver({ mx: 'ETIMEOUT' }))).toBe(true);
  });
  it('false for an address with no domain', async () => {
    expect(await domainCanReceiveMail('nodomain', resolver({}))).toBe(false);
  });
});
