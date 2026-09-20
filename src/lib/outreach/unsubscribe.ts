import { createHmac, timingSafeEqual } from 'crypto';

// Signed, stateless unsubscribe tokens: base64url(email).hmac. Anyone holding
// a token can only unsubscribe that one address, and tokens can't be forged
// without the secret.

function secret(): string {
  const s = process.env.UNSUBSCRIBE_SECRET || process.env.CRON_SECRET;
  if (!s) throw new Error('UNSUBSCRIBE_SECRET (or CRON_SECRET) is not configured');
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('hex').slice(0, 32);
}

export function makeUnsubscribeToken(email: string): string {
  const payload = Buffer.from(email.trim().toLowerCase()).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

export function unsubscribeUrl(email: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://calldesk.tech').replace(/\/$/, '');
  return `${base}/unsubscribe/${makeUnsubscribeToken(email)}`;
}
