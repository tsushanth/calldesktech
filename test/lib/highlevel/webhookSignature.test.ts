import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign, createPublicKey } from 'crypto';
import { verifyGhlSignature, GHL_ED25519_PUBLIC_KEY } from '@/lib/highlevel/webhookSignature';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const body = JSON.stringify({ type: 'UNINSTALL', appId: 'app_1', locationId: 'loc_1' });
const signed = (b: string) => sign(null, Buffer.from(b, 'utf8'), privateKey).toString('base64');

describe('verifyGhlSignature', () => {
  it('accepts a signature over exactly these bytes', () => {
    expect(verifyGhlSignature(body, signed(body), pem)).toBe(true);
  });
  it('rejects a changed body, even by one character or whitespace', () => {
    const sig = signed(body);
    expect(verifyGhlSignature(body.replace('loc_1', 'loc_2'), sig, pem)).toBe(false);
    expect(verifyGhlSignature(body + ' ', sig, pem)).toBe(false);
    expect(verifyGhlSignature(JSON.stringify(JSON.parse(body), null, 2), sig, pem)).toBe(false); // re-serialized JSON is not the signed bytes
  });
  it('rejects a signature from another key, a bad signature, an empty one and junk', () => {
    const other = generateKeyPairSync('ed25519').privateKey;
    expect(verifyGhlSignature(body, sign(null, Buffer.from(body), other).toString('base64'), pem)).toBe(false);
    expect(verifyGhlSignature(body, Buffer.alloc(64, 1).toString('base64'), pem)).toBe(false);
    for (const s of [null, undefined, '', '   ', 'not base64 !!', Buffer.alloc(63).toString('base64'), Buffer.alloc(65).toString('base64')]) expect(verifyGhlSignature(body, s as string, pem)).toBe(false);
    expect(verifyGhlSignature(body, signed(body), 'not a pem')).toBe(false); // never throws
  });
  it('uses HighLevel\'s published key by default, which is a valid Ed25519 key', () => {
    expect(createPublicKey(GHL_ED25519_PUBLIC_KEY).asymmetricKeyType).toBe('ed25519');
    expect(verifyGhlSignature(body, signed(body))).toBe(false); // our test key is not HighLevel's
  });
});
