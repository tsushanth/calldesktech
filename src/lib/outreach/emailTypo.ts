import { domainCanReceiveMail, type Resolver } from './mxCheck';

// Pre-draft address check. Runs before a lead is drafted (drafting costs a model call), so an address that
// can never be delivered is not drafted at all, and an obvious domain typo ("hotmial.com") is fixed instead
// of bouncing. Send-time MX + mailbox verification (sender.ts, emailVerify.ts) stays as the backstop.
//
// Only domains one edit away from a major mailbox provider are corrected. That is safe because the
// provider list is fixed and a legitimate business domain is very unlikely to sit one edit from one.

const PROVIDERS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'aol.com', 'protonmail.com', 'proton.me', 'yahoo.co.uk', 'hotmail.co.uk', 'online.no', 'hotmail.no', 'live.no',
];
// Real providers that sit one edit from a PROVIDERS entry (mail.com vs gmail.com): never "corrected".
const REAL_NEAR_MISSES = ['mail.com', 'email.com', 'ymail.com', 'gmx.com', 'gmx.net', 'me.com', 'mac.com', 'zoho.com', 'fastmail.com', 'pm.me', 'hey.com', 'inbox.com', 'att.net', 'comcast.net', 'verizon.net', 'cox.net', 'bellsouth.net', 'sbcglobal.net', 'live.co.uk', 'outlook.no'];
const TLD_FIXES: Record<string, string> = { con: 'com', cmo: 'com', vom: 'com', ocm: 'com', cim: 'com', coom: 'com', comm: 'com' };
const SYNTAX = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/;

/** Optimal-string-alignment distance (Levenshtein plus adjacent transposition), early exit above 1. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // one substitution
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // one transposition
  }
  const [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
  return longer.slice(i + 1) === shorter.slice(i); // one insertion/deletion
}

/** The corrected address, or null when the address needs no correction. */
export function correctEmailTypo(email: string): string | null {
  const addr = email.trim().toLowerCase();
  const at = addr.lastIndexOf('@');
  if (at < 1) return null;
  const local = addr.slice(0, at);
  let domain = addr.slice(at + 1);
  if (PROVIDERS.includes(domain) || REAL_NEAR_MISSES.includes(domain)) return null;
  const labels = domain.split('.');
  const tld = labels[labels.length - 1];
  if (TLD_FIXES[tld]) { labels[labels.length - 1] = TLD_FIXES[tld]; domain = labels.join('.'); }
  const hit = PROVIDERS.find((p) => p.length >= 8 && withinOneEdit(domain, p));
  if (hit) domain = hit;
  const fixed = `${local}@${domain}`;
  return fixed === addr ? null : fixed;
}

export type PreDraftCheck =
  | { ok: true; email: string; corrected: boolean }
  | { ok: false; reason: 'syntax' | 'no-mail-server'; email: string };

export async function preDraftEmailCheck(email: string, resolver?: Resolver): Promise<PreDraftCheck> {
  const raw = email.trim().toLowerCase();
  if (!SYNTAX.test(raw)) return { ok: false, reason: 'syntax', email: raw };
  const fixed = correctEmailTypo(raw);
  const addr = fixed ?? raw;
  if (!(await domainCanReceiveMail(addr, resolver))) return { ok: false, reason: 'no-mail-server', email: addr };
  return { ok: true, email: addr, corrected: fixed !== null };
}
