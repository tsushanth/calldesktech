import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const save = vi.fn(async () => undefined);
const snapshot = vi.fn();
vi.mock('@/lib/status/store', async (orig) => {
  const real = await orig<typeof import('@/lib/status/store')>();
  return { ...real, saveProbeResults: (...a: unknown[]) => (save as (...x: unknown[]) => Promise<void>)(...a), getStatusSnapshot: () => snapshot() };
});
vi.mock('@/lib/status/probe', async (orig) => {
  const real = await orig<typeof import('@/lib/status/probe')>();
  return { ...real, runAllProbes: async () => [{ component: 'web', status: 'operational', http_code: 200, latency_ms: 12, checked_at: 'x' }] };
});

import { POST } from '@/app/api/status/probe/route';
import { GET } from '@/app/api/status/route';
import { GET as health } from '@/app/api/health/route';
import { allOperational } from '../helpers/statusFixtures';

const req = (headers: Record<string, string> = {}) => new NextRequest('http://localhost/api/status/probe', { method: 'POST', headers });

beforeEach(() => { save.mockClear(); snapshot.mockReset(); process.env.CRON_SECRET = 's3cret-value'; });

describe('POST /api/status/probe auth', () => {
  it('401 without bearer and stores nothing', async () => {
    expect((await POST(req())).status).toBe(401);
    expect(save).not.toHaveBeenCalled();
  });
  it('401 with wrong bearer, and when CRON_SECRET is unset', async () => {
    expect((await POST(req({ authorization: 'Bearer nope' }))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await POST(req({ authorization: 'Bearer ' }))).status).toBe(401);
  });
  it('200 with the right bearer, stores results', async () => {
    const res = await POST(req({ authorization: 'Bearer s3cret-value' }));
    expect(res.status).toBe(200);
    expect(save).toHaveBeenCalledTimes(1);
    expect((await res.json()).results[0]).toEqual({ component: 'web', status: 'operational', http_code: 200, latency_ms: 12 });
  });
  it('500 when results cannot be stored', async () => {
    save.mockRejectedValueOnce(new Error('db down'));
    expect((await POST(req({ authorization: 'Bearer s3cret-value' }))).status).toBe(500);
  });
});

describe('GET /api/status', () => {
  it('returns the public shape with short cache headers', async () => {
    snapshot.mockResolvedValue(allOperational());
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/s-maxage=30/);
    const j = await res.json();
    expect(j.overall).toBe('operational');
    expect(j.components[0].days).toHaveLength(90);
  });
  it('503 uncached when the database is unreachable', async () => {
    snapshot.mockRejectedValue(new Error('boom'));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('GET /api/health', () => {
  it('returns only {ok:true}', async () => {
    expect(await (await health()).json()).toEqual({ ok: true });
  });
});
