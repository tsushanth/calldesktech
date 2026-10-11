import type { CheckStatus, ProbeResult } from './types';

// Probe definitions and classification. Pure apart from the injected fetch, so it is unit-testable.
//
// Classification (documented on /status):
//   down        -- network error, timeout (8 s), non-2xx, or a 2xx whose body says the service is not OK
//   degraded    -- responded correctly but slower than the component's threshold, or reports load shedding
//   operational -- responded correctly within the threshold

export const PROBE_TIMEOUT_MS = 8000;

export interface ProbeRequest {
  url: string;
  /** Inspect the parsed JSON body. Return 'down' for a wrong body, 'degraded' for a self-reported problem. */
  inspect?: (body: unknown) => CheckStatus;
}

export interface ProbeTarget {
  id: string;
  name: string;
  description: string;
  degradedMs: number;
  requests: ProbeRequest[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function buildTargets(env: Record<string, string | undefined> = process.env): ProbeTarget[] {
  const web = (env.STATUS_WEB_BASE_URL || 'https://calldesk.tech').replace(/\/$/, '');
  const engine = (env.STATUS_ENGINE_URL || 'https://call-loop-poc.fly.dev').replace(/\/$/, '');
  const tts = (env.STATUS_TTS_URL || 'https://realtime-tts-gateway.fly.dev').replace(/\/$/, '');
  return [
    {
      id: 'web',
      name: 'Web app and dashboard',
      description: 'calldesk.tech homepage and the application server behind the dashboard.',
      degradedMs: 3000,
      requests: [
        { url: `${web}/` },
        { url: `${web}/api/health`, inspect: (b) => (isObj(b) && b.ok === true ? 'operational' : 'down') },
      ],
    },
    {
      id: 'api',
      name: 'Public API',
      description: 'The versioned REST API layer (checked through its public OpenAPI document, no authentication).',
      degradedMs: 2000,
      requests: [{ url: `${web}/api/v1/openapi.json`, inspect: (b) => (isObj(b) && typeof b.openapi === 'string' ? 'operational' : 'down') }],
    },
    {
      id: 'engine',
      name: 'Call engine',
      description: 'The realtime service that runs live phone calls.',
      degradedMs: 2000,
      requests: [{ url: `${engine}/health`, inspect: (b) => (isObj(b) && b.ok === true ? 'operational' : 'down') }],
    },
    {
      id: 'voice',
      name: 'Voice (text-to-speech)',
      description: 'The speech synthesis gateway the call engine depends on.',
      degradedMs: 2000,
      requests: [
        {
          url: `${tts}/health`,
          inspect: (b) => {
            if (!isObj(b) || b.status !== 'ok') return isObj(b) && typeof b.status === 'string' ? 'degraded' : 'down';
            const level = isObj(b.inflight) ? b.inflight.level : undefined;
            return level === 'page' || level === 'shed' ? 'degraded' : 'operational';
          },
        },
      ],
    },
  ];
}

const RANK: Record<CheckStatus, number> = { operational: 0, degraded: 1, down: 2 };
export const worst = (a: CheckStatus, b: CheckStatus): CheckStatus => (RANK[b] > RANK[a] ? b : a);

interface OneResult { status: CheckStatus; code: number | null; ms: number | null }

async function runRequest(req: ProbeRequest, degradedMs: number, fetchImpl: typeof fetch): Promise<OneResult> {
  const t0 = Date.now();
  try {
    const res = await fetchImpl(req.url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: 'no-store',
      headers: { 'user-agent': 'calldesk-status-probe/1', accept: 'application/json, text/html' },
    });
    const ms = Date.now() - t0;
    if (res.status < 200 || res.status >= 300) {
      await res.body?.cancel?.().catch(() => undefined);
      return { status: 'down', code: res.status, ms };
    }
    let status: CheckStatus = ms > degradedMs ? 'degraded' : 'operational';
    if (req.inspect) {
      try {
        status = worst(status, req.inspect(await res.json()));
      } catch {
        status = 'down'; // 2xx but not the JSON we expect
      }
    } else {
      await res.body?.cancel?.().catch(() => undefined);
    }
    return { status, code: res.status, ms };
  } catch {
    return { status: 'down', code: null, ms: Date.now() - t0 };
  }
}

export async function runProbe(target: ProbeTarget, fetchImpl: typeof fetch = fetch, now: () => Date = () => new Date()): Promise<ProbeResult> {
  const results = await Promise.all(target.requests.map((r) => runRequest(r, target.degradedMs, fetchImpl)));
  const status = results.reduce<CheckStatus>((acc, r) => worst(acc, r.status), 'operational');
  const failing = results.find((r) => r.status === 'down');
  const code = (failing ?? results[0]).code;
  const latencies = results.map((r) => r.ms).filter((m): m is number => m !== null);
  return {
    component: target.id,
    status,
    http_code: code,
    latency_ms: latencies.length ? Math.max(...latencies) : null,
    checked_at: now().toISOString(),
  };
}

export async function runAllProbes(targets: ProbeTarget[] = buildTargets(), fetchImpl: typeof fetch = fetch): Promise<ProbeResult[]> {
  return Promise.all(targets.map((t) => runProbe(t, fetchImpl)));
}
