import { createPublicKey, verify, type KeyObject } from 'crypto';

// Verifies webhooks from HighLevel (app INSTALL / UNINSTALL and other events).
// HighLevel signs the raw request body with an Ed25519 key and sends the base64 signature in X-GHL-Signature.
// The public key is the one HighLevel publishes in its webhook guide (marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide).
// The older RSA header (X-WH-Signature) was retired on 2026-09-01 and is deliberately not accepted.

export const GHL_SIGNATURE_HEADER = 'x-ghl-signature';

export const GHL_ED25519_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----
`;

let defaultKey: KeyObject | null = null;

/** True only for a valid signature over exactly these body bytes. Never throws. */
export function verifyGhlSignature(rawBody: string, signatureBase64: string | null | undefined, publicKeyPem?: string): boolean {
  if (!signatureBase64 || typeof rawBody !== 'string') return false;
  try {
    const key = publicKeyPem ? createPublicKey(publicKeyPem) : (defaultKey ??= createPublicKey(GHL_ED25519_PUBLIC_KEY));
    const sig = Buffer.from(signatureBase64.trim(), 'base64');
    if (sig.length !== 64) return false; // an Ed25519 signature is exactly 64 bytes
    return verify(null, Buffer.from(rawBody, 'utf8'), key, sig);
  } catch {
    return false;
  }
}
