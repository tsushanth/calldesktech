import { describe, it, expect } from 'vitest';
import { decryptToken, encryptToken, signLinkToken, verifyLinkToken } from '@/lib/highlevel/crypto';

const ENV = { HIGHLEVEL_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64'), HIGHLEVEL_LINK_SECRET: 'a-long-test-secret-value' };

describe('token encryption', () => {
  it('round-trips and never stores the plain text', () => {
    const enc = encryptToken('pit-secret-token', ENV);
    expect(enc.startsWith('v1.')).toBe(true);
    expect(enc).not.toContain('pit-secret-token');
    expect(decryptToken(enc, ENV)).toBe('pit-secret-token');
  });
  it('uses a fresh iv each time', () => {
    expect(encryptToken('same', ENV)).not.toBe(encryptToken('same', ENV));
  });
  it('rejects a tampered ciphertext, the wrong key and an unknown format', () => {
    const enc = encryptToken('x', ENV);
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered-bytes').toString('base64url');
    expect(() => decryptToken(parts.join('.'), ENV)).toThrow();
    expect(() => decryptToken(enc, { ...ENV, HIGHLEVEL_TOKEN_KEY: Buffer.alloc(32, 9).toString('base64') })).toThrow();
    expect(() => decryptToken('v2.a.b.c', ENV)).toThrow();
  });
  it('requires a 32 byte key', () => {
    expect(() => encryptToken('x', {})).toThrow(/HIGHLEVEL_TOKEN_KEY/);
    expect(() => encryptToken('x', { HIGHLEVEL_TOKEN_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/32 bytes/);
  });
});

describe('link token', () => {
  it('returns the location id for a fresh token', () => {
    expect(verifyLinkToken(signLinkToken('loc_123', 1_000, ENV), 2_000, ENV)).toBe('loc_123');
  });
  it('expires after an hour', () => {
    const t = signLinkToken('loc_123', 1_000, ENV);
    expect(verifyLinkToken(t, 1_000 + 59 * 60_000, ENV)).toBe('loc_123');
    expect(verifyLinkToken(t, 1_000 + 61 * 60_000, ENV)).toBeNull();
  });
  it('rejects a changed body, a changed signature, a different secret and junk', () => {
    const t = signLinkToken('loc_123', 1_000, ENV);
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ l: 'loc_999', e: 9_999_999_999_999 })).toString('base64url');
    expect(verifyLinkToken(`${forged}.${sig}`, 2_000, ENV)).toBeNull();
    expect(verifyLinkToken(`${body}.${sig.slice(0, -2)}AA`, 2_000, ENV)).toBeNull();
    expect(verifyLinkToken(t, 2_000, { ...ENV, HIGHLEVEL_LINK_SECRET: 'another-long-secret-value' })).toBeNull();
    expect(verifyLinkToken('', 2_000, ENV)).toBeNull();
    expect(verifyLinkToken('not-a-token', 2_000, ENV)).toBeNull();
  });
});
