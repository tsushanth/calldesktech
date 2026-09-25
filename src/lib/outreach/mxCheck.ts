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

// False only when DNS definitively says the domain cannot receive mail (no MX and no A/AAAA).
// Timeouts and server failures return true: a flaky lookup must never block a legitimate send.
export async function domainCanReceiveMail(email: string, resolver: Resolver = dns): Promise<boolean> {
  const domain = email.split('@')[1]?.trim().toLowerCase();
  if (!domain) return false;
  const mx = await has(() => resolver.resolveMx(domain));
  if (mx !== false) return true;
  const a = await has(() => resolver.resolve4(domain));
  if (a !== false) return true;
  const aaaa = await has(() => resolver.resolve6(domain));
  return aaaa !== false;
}
