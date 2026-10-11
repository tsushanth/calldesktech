/**
 * Sends backend failures to the unified app-failure-reporter Worker (dedupes and emails).
 * Fire-and-forget: never throws, never blocks a request. Set FAILURE_REPORTER_DISABLED=1 to silence (tests/dev).
 * Never pass user content (transcripts, note text, emails) as message or context.
 */
// No built-in endpoint or key: this repo is public. Without BOTH FAILURE_REPORTER_URL and
// FAILURE_REPORTER_KEY in the environment the reporter is a no-op.
const APP_VERSION = process.env.FLY_IMAGE_REF || process.env.K_REVISION || process.env.npm_package_version || 'unknown';
const DISABLED = process.env.FAILURE_REPORTER_DISABLED === '1' || ((process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') && process.env.FAILURE_REPORTER_FORCE !== '1');

function config(): { url: string; key: string } | null {
  const url = process.env.FAILURE_REPORTER_URL;
  const key = process.env.FAILURE_REPORTER_KEY;
  return url && key ? { url, key } : null;
}

type Kind = 'crash' | 'failure' | 'backend_error';

async function post(kind: Kind, flow: string, err: unknown, context: Record<string, string>, timeoutMs: number): Promise<void> {
  if (DISABLED) return;
  const cfg = config();
  if (!cfg) return;
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Report-Key': cfg.key },
      body: JSON.stringify({ kind, platform: 'backend', version: APP_VERSION, flow, message: e.message || e.name, stack: e.stack ?? '', context }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { /* reporting must never cause a failure of its own */ }
}

/** A handled server error (5xx). Path only: never log query strings, they can carry tokens. */
export function reportBackendError(req: { method: string; path?: string }, err: unknown, statusCode: number): void {
  if (statusCode < 500) return;
  void post('backend_error', `${req.method} ${req.path ?? ''}`, err, { status: String(statusCode) }, 5000);
}

/** A background job or flow failed (worker, queue, cron). */
export function reportFailure(flow: string, err: unknown, context: Record<string, string> = {}): void {
  void post('failure', flow, err, context, 5000);
}

/** Process is about to die: await this before process.exit so the email actually goes out. */
export function reportCrash(flow: string, err: unknown): Promise<void> {
  return post('crash', flow, err, {}, 2500);
}

/**
 * Next.js server hook: reports every 5xx JSON response plus process-level crashes.
 * Routes here build their own error responses (200+ `status: 500` sites), so one central
 * wrapper is the only practical place to see them. NextResponse.json delegates to the global
 * Response.json, which is shared across Next's separately bundled copies (wrapping
 * NextResponse itself misses route handlers). The route file is recovered from the stack so
 * the same failing route dedupes to one email.
 */
export function installServerFailureReporting(): void {
  if (DISABLED || !config()) return;
  let sent = 0;
  let windowStart = Date.now();
  // Shared-by-design Next internal holding the matched route pattern (e.g. /api/calls/[id]/route).
  let currentRoute: () => string | undefined = () => undefined;
  void import('next/dist/server/app-render/work-async-storage.external')
    .then((m) => { currentRoute = () => m.workAsyncStorage.getStore()?.route; })
    .catch(() => { /* fall back to the stack-derived name */ });
  const original = Response.json.bind(Response);
  Response.json = (body: unknown, init?: ResponseInit) => {
    const status = init?.status ?? 200;
    if (status >= 500) {
      const now = Date.now();
      if (now - windowStart > 60_000) { windowStart = now; sent = 0; }
      if (++sent <= 30) {
        const stack = new Error().stack ?? '';
        const route = currentRoute() ?? /app\/api\/[^\s:)]*?(?=\/route|\.js|\.ts)/.exec(stack)?.[0] ?? 'unknown route';
        const msg = body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
          ? (body as { error: string }).error : `HTTP ${status}`;
        const err = new Error(msg.slice(0, 300));
        err.stack = stack;
        void post('backend_error', route, err, { status: String(status) }, 5000);
      }
    }
    return original(body, init);
  };
  // Observe-only: does not change Node's (or Next's) crash behaviour.
  process.on('uncaughtExceptionMonitor', (err) => { void post('crash', 'uncaughtException', err, {}, 2500); });
}

/** Next's onRequestError: unhandled errors thrown from routes, pages and server actions. */
export function reportRequestError(err: unknown, request: { method: string; path: string }): void {
  void post('backend_error', `${request.method} ${request.path.split('?')[0]}`, err, { status: '500' }, 5000);
}
