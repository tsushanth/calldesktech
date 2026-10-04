import { promises as dns } from 'dns';

export interface Resolver {
  resolveMx(host: string): Promise<unknown[]>;
  resolve4(host: string): Promise<unknown[]>;
  resolve6(host: string): Promise<unknown[]>;
}

const NO_RECORD = new Set(['ENOTFOUND', 'ENODATA']);

async function has(fn: () => Promise<unknown[]>): Promise<boolean | 'unknown'> {
  try {
    return (await fn()).length > 0;
  } catch (err) {
    return NO_RECORD.has((err as { code?: string }).code || '') ? false : 'unknown';
  }
}

// False only when DNS definitively says the domain has no MX record. The RFC fallback to an A/AAAA
// record is deliberately NOT honored: 3 of the first 13 real bounces were domains with an A record but
// no MX (website hosting, no mail), while only 1 of 189 delivered domains relied on the fallback.
// Timeouts and server failures return true: a flaky lookup must never block a legitimate send.
export async function domainCanReceiveMail(email: string, resolver: Resolver = dns): Promise<boolean> {
  const domain = email.split('@')[1]?.trim().toLowerCase();
  if (!domain) return false;
  return (await has(() => resolver.resolveMx(domain))) !== false;
}
