import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs helper without types
import { diagnoseMissingLog } from '../scripts/regression/lib.mjs';

const fakeDb = (rows: unknown[]) => ({ select: async () => rows });

describe('regression harness: diagnoseMissingLog', () => {
  it('a row under 5 s with no transcript is a retryable cut-off (deploy/restart mid-call)', async () => {
    const r = await diagnoseMissingLog(fakeDb([{ duration_seconds: 0, transcript: [] }]), 't1', '2026-10-03T20:00:00Z');
    expect(r.retryable).toBe(true);
    expect(r.message).toMatch(/under 5 s/);
  });
  it('no rows at all means the call never reached the engine, not retryable', async () => {
    const r = await diagnoseMissingLog(fakeDb([]), 't1', '2026-10-03T20:00:00Z');
    expect(r.retryable).toBe(false);
    expect(r.message).toMatch(/did the call reach the engine/);
  });
  it('a long row with no transcript is not treated as a cut-off', async () => {
    const r = await diagnoseMissingLog(fakeDb([{ duration_seconds: 40, transcript: null }]), 't1', '2026-10-03T20:00:00Z');
    expect(r.retryable).toBe(false);
  });
});
