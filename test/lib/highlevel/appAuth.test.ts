import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { requireAppSecret } from '@/lib/highlevel/appAuth';

const SECRET = 'a-long-shared-secret-123';
const req = (headers: Record<string, string> = {}, qs = '') => new NextRequest(`https://calldesk.tech/api/highlevel/x${qs}`, { method: 'POST', headers });

describe('requireAppSecret', () => {
  it('accepts the secret in the header or in ?k=', () => {
    expect(requireAppSecret(req({ 'x-calldesk-secret': SECRET }), { HIGHLEVEL_APP_SECRET: SECRET })).toBeNull();
    expect(requireAppSecret(req({}, `?k=${SECRET}`), { HIGHLEVEL_APP_SECRET: SECRET })).toBeNull();
  });
  it('rejects a missing, wrong or different-length secret with 401', async () => {
    for (const r of [req(), req({ 'x-calldesk-secret': 'wrong-secret-of-same-len' }), req({ 'x-calldesk-secret': SECRET + 'x' }), req({}, '?k=')]) {
      expect(requireAppSecret(r, { HIGHLEVEL_APP_SECRET: SECRET })?.status).toBe(401);
    }
  });
  it('fails closed with 503 when the secret is not configured or too short', () => {
    expect(requireAppSecret(req({ 'x-calldesk-secret': '' }), {})?.status).toBe(503);
    expect(requireAppSecret(req({ 'x-calldesk-secret': 'short' }), { HIGHLEVEL_APP_SECRET: 'short' })?.status).toBe(503);
  });
});
