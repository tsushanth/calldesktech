import { describe, it, expect } from 'vitest';
import { buildTargets, runProbe, runAllProbes } from '@/lib/status/probe';

const targets = buildTargets({});
const t = (id: string) => targets.find((x) => x.id === id)!;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const slow = (ms: number, res: () => Response): typeof fetch => (async () => { await new Promise((r) => setTimeout(r, ms)); return res(); }) as typeof fetch;

describe('probe classification', () => {
  it('engine: ok body within threshold is operational and keeps code and latency', async () => {
    const r = await runProbe(t('engine'), (async () => json({ ok: true, activeCalls: 3 })) as typeof fetch);
    expect(r).toMatchObject({ component: 'engine', status: 'operational', http_code: 200 });
    expect(r.latency_ms).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(r)).not.toContain('activeCalls');
  });

  it('engine: ok:false body is down even on HTTP 200', async () => {
    expect((await runProbe(t('engine'), (async () => json({ ok: false })) as typeof fetch)).status).toBe('down');
  });

  it('slow response beyond the threshold is degraded', async () => {
    const target = { ...t('engine'), degradedMs: 20 };
    const r = await runProbe(target, slow(60, () => json({ ok: true })));
    expect(r.status).toBe('degraded');
    expect(r.http_code).toBe(200);
  });

  it('non-2xx is down with the code recorded', async () => {
    const r = await runProbe(t('api'), (async () => new Response('x', { status: 503 })) as typeof fetch);
    expect(r).toMatchObject({ status: 'down', http_code: 503 });
  });

  it('network error and timeout are down with no code', async () => {
    const boom = await runProbe(t('voice'), (async () => { throw new TypeError('fetch failed'); }) as typeof fetch);
    expect(boom).toMatchObject({ status: 'down', http_code: null });
    const timeout = await runProbe(t('voice'), (async () => { throw new DOMException('timed out', 'TimeoutError'); }) as typeof fetch);
    expect(timeout).toMatchObject({ status: 'down', http_code: null });
  });

  it('passes an 8 second abort signal to fetch', async () => {
    let signal: AbortSignal | undefined;
    await runProbe(t('engine'), (async (_u: unknown, init?: RequestInit) => { signal = init?.signal ?? undefined; return json({ ok: true }); }) as typeof fetch);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('api: 2xx that is not an OpenAPI document is down', async () => {
    expect((await runProbe(t('api'), (async () => json({ hello: 1 })) as typeof fetch)).status).toBe('down');
    expect((await runProbe(t('api'), (async () => json({ openapi: '3.1.0' })) as typeof fetch)).status).toBe('operational');
  });

  it('voice: load shedding is degraded, unhealthy status is degraded, garbage is down', async () => {
    expect((await runProbe(t('voice'), (async () => json({ status: 'ok', inflight: { level: 'ok' } })) as typeof fetch)).status).toBe('operational');
    expect((await runProbe(t('voice'), (async () => json({ status: 'ok', inflight: { level: 'shed' } })) as typeof fetch)).status).toBe('degraded');
    expect((await runProbe(t('voice'), (async () => json({ status: 'degraded' })) as typeof fetch)).status).toBe('degraded');
    expect((await runProbe(t('voice'), (async () => new Response('<html>', { status: 200 })) as typeof fetch)).status).toBe('down');
  });

  it('web: needs both the homepage and /api/health; either failing is down', async () => {
    const ok = (async (u: string) => (String(u).endsWith('/api/health') ? json({ ok: true }) : new Response('<html/>', { status: 200 }))) as unknown as typeof fetch;
    expect((await runProbe(t('web'), ok)).status).toBe('operational');
    const homeDown = (async (u: string) => (String(u).endsWith('/api/health') ? json({ ok: true }) : new Response('x', { status: 500 }))) as unknown as typeof fetch;
    expect(await runProbe(t('web'), homeDown)).toMatchObject({ status: 'down', http_code: 500 });
    const healthDown = (async (u: string) => (String(u).endsWith('/api/health') ? new Response('x', { status: 502 }) : new Response('<html/>', { status: 200 }))) as unknown as typeof fetch;
    expect(await runProbe(t('web'), healthDown)).toMatchObject({ status: 'down', http_code: 502 });
  });

  it('runAllProbes returns one result per component, in parallel', async () => {
    const f = (async (u: string) => (String(u).includes('openapi') ? json({ openapi: '3.1.0' }) : json({ ok: true, status: 'ok' }))) as unknown as typeof fetch;
    const r = await runAllProbes(targets, f);
    expect(r.map((x) => x.component).sort()).toEqual(['api', 'engine', 'voice', 'web']);
    expect(r.every((x) => x.status === 'operational')).toBe(true);
  });
});
