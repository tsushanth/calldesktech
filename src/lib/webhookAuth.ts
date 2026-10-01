import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify } from 'crypto';

// Header used when telnyx-sms forwards an already-verified inbound SMS to
// trial-sms internally, so trial-sms (which is also directly reachable from
// Telnyx per its own webhook config) doesn't re-require a Telnyx/Twilio
// signature on a request that never had one to begin with. Fails open (like
// the other checks here) if INTERNAL_WEBHOOK_SECRET isn't configured, so
// this doesn't need to be set for the app to keep working — but without it,
// trial-sms's own signature check is what protects it.
export const INTERNAL_FORWARD_HEADER = 'x-internal-webhook-secret';

export function internalForwardHeaders(): Record<string, string> {
  const secret = process.env.INTERNAL_WEBHOOK_SECRET;
  return secret ? { [INTERNAL_FORWARD_HEADER]: secret } : {};
}

export function verifyInternalForward(headerValue: string | null): VerifyResult {
  const secret = process.env.INTERNAL_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: 'INTERNAL_WEBHOOK_SECRET not configured' };
  if (!headerValue) return { ok: false, reason: 'missing internal forward header' };
  const a = Buffer.from(headerValue);
  const b = Buffer.from(secret);
  const valid = a.length === b.length && timingSafeEqual(a, b);
  return valid ? { ok: true } : { ok: false, reason: 'internal forward secret mismatch' };
}

// Shared inbound-SMS webhook authentication for Telnyx and Twilio.
//
// Both checks are "fail-open when unconfigured, fail-closed when configured":
// if the relevant secret/public key env var isn't set, we log a warning and
// let the request through (so this doesn't silently 401 all inbound SMS
// before the secret is provisioned as a Fly secret). Once configured, a
// request that fails verification is rejected.

const TELNYX_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Verify a Telnyx webhook using their Ed25519 signature scheme.
 *
 * Telnyx sends:
 *   - `telnyx-signature-ed25519`: base64-encoded Ed25519 signature
 *   - `telnyx-timestamp`: unix timestamp (seconds) the request was signed at
 *
 * The signed message is `${timestamp}|${rawBody}`, verified against the
 * public key shown in the Telnyx portal (Public key for webhook signing),
 * configured here as TELNYX_PUBLIC_KEY (base64-encoded raw 32-byte Ed25519 key).
 *
 * NOTE: this matches Telnyx's documented webhook signing scheme as best
 * understood without live access to Telnyx's docs in this environment.
 * The header names and "timestamp|body" signed-payload format are Telnyx's
 * documented convention (mirroring Discord's Ed25519 webhook scheme), but
 * this has not been verified against a live Telnyx signature in this repo.
 * Treat this as medium confidence — verify against a real Telnyx webhook
 * delivery (or their docs) before relying on it to reject traffic in prod.
 */
export function verifyTelnyxSignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
): VerifyResult {
  const publicKeyB64 = process.env.TELNYX_PUBLIC_KEY;
  if (!publicKeyB64) {
    console.warn('[webhookAuth] TELNYX_PUBLIC_KEY not configured — skipping Telnyx signature verification (fail-open)');
    return { ok: true };
  }

  if (!signatureHeader || !timestampHeader) {
    return { ok: false, reason: 'missing telnyx-signature-ed25519/telnyx-timestamp header' };
  }

  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TELNYX_TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp out of tolerance' };
  }

  try {
    const signature = Buffer.from(signatureHeader, 'base64');
    const signedPayload = Buffer.from(`${timestampHeader}|${rawBody}`, 'utf8');
    // Node's crypto doesn't accept a raw 32-byte Ed25519 key directly; wrap
    // it as a JWK (OKP/Ed25519) so createPublicKey can parse it.
    const rawKey = Buffer.from(publicKeyB64, 'base64');
    const jwk = {
      kty: 'OKP',
      crv: 'Ed25519',
      x: rawKey.toString('base64url'),
    };
    const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
    const valid = cryptoVerify(null, signedPayload, publicKey, signature);
    return valid ? { ok: true } : { ok: false, reason: 'signature mismatch' };
  } catch (e) {
    return { ok: false, reason: `verification error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Verify a Twilio webhook using their X-Twilio-Signature HMAC-SHA1 scheme.
 *
 * signature = base64(HMAC-SHA1(authToken, url + sorted-concat(param+value)))
 * for form-encoded POSTs. `url` must be the exact URL Twilio was configured
 * to POST to (including query string, if any).
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signatureHeader: string | null,
  // Defaults keep the original behavior (main-account token, fail-open when unset). A route that
  // places calls passes its own account's token and failClosed so a missing secret rejects instead
  // of letting anyone on the internet trigger a call.
  opts: { authToken?: string; failClosed?: boolean } = {},
): VerifyResult {
  const authToken = opts.authToken ?? process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    if (opts.failClosed) return { ok: false, reason: 'Twilio auth token not configured' };
    console.warn('[webhookAuth] TWILIO_AUTH_TOKEN not configured — skipping Twilio signature verification (fail-open)');
    return { ok: true };
  }

  if (!signatureHeader) {
    return { ok: false, reason: 'missing X-Twilio-Signature header' };
  }

  try {
    const sortedKeys = Object.keys(params).sort();
    let data = url;
    for (const key of sortedKeys) {
      data += key + params[key];
    }
    const expected = createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
    const expectedBuf = Buffer.from(expected, 'base64');
    const givenBuf = Buffer.from(signatureHeader, 'base64');
    const valid = expectedBuf.length === givenBuf.length && timingSafeEqual(expectedBuf, givenBuf);
    return valid ? { ok: true } : { ok: false, reason: 'signature mismatch' };
  } catch (e) {
    return { ok: false, reason: `verification error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
