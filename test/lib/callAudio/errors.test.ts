import { describe, it, expect } from 'vitest';
import { toHttpError } from '@/lib/callAudio/errors';
import { ReadAloudError } from '@/lib/callAudio/readaloudClient';
import { CallAudioError } from '@/lib/callAudio/assets';

describe('toHttpError', () => {
  it('passes CallAudioError status and message through (they are written for the user)', () => {
    expect(toHttpError(new CallAudioError('Name must be short', 400))).toEqual({ status: 400, message: 'Name must be short' });
    expect(toHttpError(new CallAudioError('too many', 409)).status).toBe(409);
  });
  it.each([
    ['invalid_input', 400], ['payment_required', 402], ['rate_limited', 429],
    ['capacity', 503], ['pending', 504], ['not_configured', 503], ['upstream', 502],
  ] as const)('maps ReadAloud %s to HTTP %i', (code, status) => {
    expect(toHttpError(new ReadAloudError(code, 'x', false)).status).toBe(status);
  });
  it('does NOT surface ReadAloud rejecting our own API key as a 401 (that is our config problem, not the user\'s login)', () => {
    const e = toHttpError(new ReadAloudError('unauthorized', 'ReadAloud rejected the API key.'));
    expect(e.status).toBe(502);
    expect(e.message).not.toMatch(/api key/i);
  });
  it('turns an unknown error into a generic 500 without leaking its message', () => {
    expect(toHttpError(new Error('connection string postgres://user:pw@host'))).toEqual({ status: 500, message: 'Something went wrong saving this audio' });
    expect(toHttpError('weird')).toEqual({ status: 500, message: 'Something went wrong saving this audio' });
  });
  it('a silent-clip conversion error is a user-actionable 422', () => {
    expect(toHttpError(new Error('Generated audio is silent')).status).toBe(422);
  });
});
