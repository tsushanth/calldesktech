// Runs a flow 'code' node's JavaScript for the text simulator. Port of
// _executeCodeNode in realtime-tts/call-loop-poc/server.js: QuickJS compiled
// to WASM (a separate memory space, not Node's vm), 10s / 16MB limits, `dv`
// (collectedData) as the only input, and a synchronous `fetch` that goes
// through safeFetch. No process secrets are ever exposed to the script.
//
// This also runs for public chat visitors, so the module is loaded lazily and
// any failure to load or run it comes back as { ok: false } instead of
// throwing: a broken sandbox must never break the chat.

import { safeFetch } from '@/lib/safeFetch';

const TIMEOUT_MS = 10_000;
const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_CHARS = 20_000;
const MAX_OUTPUT_CHARS = 2_000;

export type CodeResult = { ok: true; value: unknown; serialized: string } | { ok: false; error: string };

export async function runCodeNode(code: string, collectedData: Record<string, string>): Promise<CodeResult> {
  const source = String(code || '').slice(0, MAX_SOURCE_CHARS);
  if (!source.trim()) return { ok: false, error: 'no code' };

  let context: import('quickjs-emscripten').QuickJSAsyncContext | undefined;
  try {
    const { newAsyncContext, shouldInterruptAfterDeadline } = await import('quickjs-emscripten');
    context = await newAsyncContext();
    context.runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
    context.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + TIMEOUT_MS));

    const dv = context.unwrapResult(context.evalCode(`(${JSON.stringify(collectedData || {})})`));
    context.setProp(context.global, 'dv', dv);
    dv.dispose();

    const ctx = context;
    ctx.newAsyncifiedFunction('__hostFetch', async (urlHandle, optionsHandle) => {
      let options: { method?: string; headers?: Record<string, string>; body?: string } = {};
      try { options = JSON.parse(ctx.getString(optionsHandle)); } catch { /* default {} */ }
      try {
        const res = await safeFetch(ctx.getString(urlHandle), {
          method: (options.method || 'GET').toUpperCase(),
          headers: options.headers && typeof options.headers === 'object' ? options.headers : undefined,
          body: typeof options.body === 'string' ? options.body : undefined,
          timeoutMs: 8000,
          maxBytes: 200_000,
        });
        const text = await res.text();
        return ctx.newString(JSON.stringify({ status: res.status, ok: res.ok, body: text.slice(0, 100_000) }));
      } catch (err) {
        return ctx.newString(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    }).consume((fn) => ctx.setProp(ctx.global, '__hostFetch', fn));

    const wrapped =
      `function fetch(url, options) {\n` +
      `  return JSON.parse(__hostFetch(String(url), JSON.stringify(options || {})));\n` +
      `}\n` +
      `(() => {\n${source}\n})();`;

    const handle = context.unwrapResult(await context.evalCodeAsync(wrapped));
    const value = context.dump(handle);
    handle.dispose();

    let serialized: string;
    try { serialized = JSON.stringify(value) ?? 'undefined'; } catch { serialized = String(value); }
    if (serialized.length > MAX_OUTPUT_CHARS) serialized = `${serialized.slice(0, MAX_OUTPUT_CHARS)}...(truncated)`;
    return { ok: true, value, serialized };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try { context?.dispose(); } catch { /* already torn down */ }
  }
}
