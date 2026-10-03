import { describe, it, expect } from 'vitest';
import { signRetellBody, verifyRetellSignature, RETELL_SIGNATURE_TOLERANCE_MS } from '@/lib/retellSignature';

const KEY = 'key_test_123';
const BODY = JSON.stringify({ event: 'call_ended', call: { call_id: 'c1', agent_id: 'a1' } });
const NOW = 1_790_000_000_000;

describe('verifyRetellSignature', () => {
  it('accepts a correctly signed, recent body', () => {
    expect(verifyRetellSignature(BODY, KEY, signRetellBody(BODY, KEY, NOW - 1000), NOW)).toBe(true);
  });
  it('rejects a changed body, a wrong key and a tampered digest', () => {
    const sig = signRetellBody(BODY, KEY, NOW);
    expect(verifyRetellSignature(BODY.replace('c1', 'c2'), KEY, sig, NOW)).toBe(false);
    expect(verifyRetellSignature(BODY, 'other-key', sig, NOW)).toBe(false);
    expect(verifyRetellSignature(BODY, KEY, sig.slice(0, -2) + (sig.endsWith('00') ? '11' : '00'), NOW)).toBe(false);
  });
  it('rejects old and far-future timestamps (replay)', () => {
    expect(verifyRetellSignature(BODY, KEY, signRetellBody(BODY, KEY, NOW - RETELL_SIGNATURE_TOLERANCE_MS - 1), NOW)).toBe(false);
    expect(verifyRetellSignature(BODY, KEY, signRetellBody(BODY, KEY, NOW + RETELL_SIGNATURE_TOLERANCE_MS + 1), NOW)).toBe(false);
    expect(verifyRetellSignature(BODY, KEY, signRetellBody(BODY, KEY, NOW - RETELL_SIGNATURE_TOLERANCE_MS + 1000), NOW)).toBe(true);
  });
  it('rejects a signature that reuses a digest with a different timestamp', () => {
    const sig = signRetellBody(BODY, KEY, NOW);
    const digest = sig.split('d=')[1];
    expect(verifyRetellSignature(BODY, KEY, `v=${NOW + 5},d=${digest}`, NOW)).toBe(false);
  });
  it('fails closed on missing key, missing header and malformed headers', () => {
    const sig = signRetellBody(BODY, KEY, NOW);
    expect(verifyRetellSignature(BODY, undefined, sig, NOW)).toBe(false);
    expect(verifyRetellSignature(BODY, '', sig, NOW)).toBe(false);
    for (const bad of [undefined, null, '', 'garbage', 'v=abc,d=00', `v=${NOW}`, `d=${'0'.repeat(64)}`, `v=${NOW},d=${'z'.repeat(64)}`, `v=${NOW},d=${'0'.repeat(63)}`]) {
      expect(verifyRetellSignature(BODY, KEY, bad as string, NOW), String(bad)).toBe(false);
    }
  });
});
