import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('FAILURE_REPORTER_FORCE', '1');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

// DISABLED is evaluated at import time (NODE_ENV=test), so re-import with the force flag set.
async function load() {
  vi.resetModules();
  return import('@/lib/failureReporter');
}

it('is a no-op when key and url are not set', async () => {
  vi.stubEnv('FAILURE_REPORTER_KEY', '');
  vi.stubEnv('FAILURE_REPORTER_URL', '');
  const m = await load();
  m.reportFailure('flow', new Error('x'));
  await new Promise((r) => setTimeout(r, 10));
  expect(fetchMock).not.toHaveBeenCalled();
});

it('is a no-op with a url but no key', async () => {
  vi.stubEnv('FAILURE_REPORTER_KEY', '');
  vi.stubEnv('FAILURE_REPORTER_URL', 'https://reporter.example/v1/report');
  const m = await load();
  m.reportFailure('flow', new Error('x'));
  await new Promise((r) => setTimeout(r, 10));
  expect(fetchMock).not.toHaveBeenCalled();
});

it('posts with the env key when both are set', async () => {
  vi.stubEnv('FAILURE_REPORTER_KEY', 'test-key');
  vi.stubEnv('FAILURE_REPORTER_URL', 'https://reporter.example/v1/report');
  const m = await load();
  m.reportFailure('flow', new Error('x'));
  await new Promise((r) => setTimeout(r, 10));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe('https://reporter.example/v1/report');
  expect(fetchMock.mock.calls[0][1].headers['X-Report-Key']).toBe('test-key');
});

it('source contains no hardcoded report key or default endpoint', () => {
  const src = readFileSync('src/lib/failureReporter.ts', 'utf8');
  expect(src).not.toMatch(/afr_[0-9a-f]{16,}/);
  expect(src).not.toMatch(/workers\.dev/);
});

