// Cloudflare Worker: calls POST /api/status/probe on calldesk.tech once a minute.
// The shared secret comes from the CRON_SECRET Worker secret (never from this repo).
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(probe(env));
  },
  // Lets you trigger one run by hand with `wrangler dev --test-scheduled` -> /__scheduled. No public fetch handler.
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};

async function probe(env) {
  if (!env.CRON_SECRET) {
    console.error('CRON_SECRET secret is not set on this Worker');
    return;
  }
  try {
    const res = await fetch(env.PROBE_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) console.error(`probe route returned HTTP ${res.status}`);
  } catch (err) {
    console.error('probe call failed:', err instanceof Error ? err.message : String(err));
  }
}
