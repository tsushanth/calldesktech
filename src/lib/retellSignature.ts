import { createHmac, timingSafeEqual } from 'node:crypto';

// Retell signs every webhook: header `x-retell-signature: v=<timestamp-ms>,d=<hex>` where d is
// HMAC-SHA256(key = the Retell API key, data = raw body + timestamp). The timestamp must be recent so a captured
// request cannot be replayed later. Mirrors retell-sdk's verify(); written out here to avoid pulling in the SDK.
export const RETELL_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

export function signRetellBody(rawBody: string, apiKey: string, timestampMs: number): string {
  const digest = createHmac('sha256', apiKey).update(rawBody + String(timestampMs)).digest('hex');
  return `v=${timestampMs},d=${digest}`;
}

export function verifyRetellSignature(rawBody: string, apiKey: string | undefined, signature: string | null | undefined, now: number = Date.now()): boolean {
  if (!apiKey || !signature) return false;
  const m = /^v=(\d{10,16}),d=([0-9a-f]{64})$/i.exec(signature.trim());
  if (!m) return false;
  const timestamp = Number(m[1]);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > RETELL_SIGNATURE_TOLERANCE_MS) return false;
  const expected = createHmac('sha256', apiKey).update(rawBody + m[1]).digest();
  const given = Buffer.from(m[2], 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
