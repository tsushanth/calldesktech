import { CallAudioError } from './assets';
import { ReadAloudError, type ReadAloudErrorCode } from './readaloudClient';

const READALOUD_STATUS: Record<ReadAloudErrorCode, number> = {
  invalid_input: 400, payment_required: 402, rate_limited: 429, capacity: 503, pending: 504,
  not_configured: 503,
  // ReadAloud rejecting OUR key is a server-side misconfiguration, not the caller's login failing —
  // a 401 here would send the user hunting for a session problem that doesn't exist.
  unauthorized: 502,
  upstream: 502,
};

const READALOUD_USER_MESSAGE: Partial<Record<ReadAloudErrorCode, string>> = {
  unauthorized: 'Audio generation is temporarily unavailable',
  not_configured: 'Audio generation is not configured yet',
};

export function toHttpError(err: unknown): { status: number; message: string } {
  if (err instanceof CallAudioError) return { status: err.status, message: err.message };
  if (err instanceof ReadAloudError) {
    return { status: READALOUD_STATUS[err.code], message: READALOUD_USER_MESSAGE[err.code] ?? err.message };
  }
  if (err instanceof Error && /silent|no audio/i.test(err.message)) {
    return { status: 422, message: 'The generated clip was silent or empty. Try a different description.' };
  }
  return { status: 500, message: 'Something went wrong saving this audio' };
}
