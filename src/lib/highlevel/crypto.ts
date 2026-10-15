import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';

// Token encryption and the signed "link" token for the HighLevel app.
//  - HIGHLEVEL_TOKEN_KEY: 32 random bytes, base64. Encrypts the HighLevel access and refresh tokens at rest (AES-256-GCM).
//  - HIGHLEVEL_LINK_SECRET: any long random string. Signs the short-lived token that proves a browser just finished the
//    HighLevel install, so only that browser can link the install to a Calldesk workspace.

type Env = Record<string, string | undefined>;

function tokenKey(env: Env): Buffer {
  const raw = env.HIGHLEVEL_TOKEN_KEY;
  if (!raw) throw new Error('HIGHLEVEL_TOKEN_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('HIGHLEVEL_TOKEN_KEY must be 32 bytes, base64 encoded');
  return key;
}

export function encryptToken(plain: string, env: Env = process.env): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(env), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptToken(encrypted: string, env: Env = process.env): string {
  const [v, iv, tag, ct] = encrypted.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognised token format');
  const decipher = createDecipheriv('aes-256-gcm', tokenKey(env), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

function linkSecret(env: Env): string {
  const s = env.HIGHLEVEL_LINK_SECRET;
  if (!s || s.length < 16) throw new Error('HIGHLEVEL_LINK_SECRET is not set (16 characters at least)');
  return s;
}

const LINK_TTL_MS = 60 * 60_000;

export function signLinkToken(locationId: string, now: number = Date.now(), env: Env = process.env): string {
  const body = Buffer.from(JSON.stringify({ l: locationId, e: now + LINK_TTL_MS })).toString('base64url');
  const sig = createHmac('sha256', linkSecret(env)).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** The location id the token was issued for, or null when it is malformed, tampered with or expired. */
export function verifyLinkToken(token: string, now: number = Date.now(), env: Env = process.env): string | null {
  try {
    const [body, sig] = String(token).split('.');
    if (!body || !sig) return null;
    const expected = createHmac('sha256', linkSecret(env)).update(body).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const { l, e } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { l?: unknown; e?: unknown };
    if (typeof l !== 'string' || !l || typeof e !== 'number' || e < now) return null;
    return l;
  } catch {
    return null;
  }
}
