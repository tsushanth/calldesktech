# Status probe scheduler

A Cloudflare Worker with a one-minute cron trigger that calls `POST https://calldesk.tech/api/status/probe`
with `Authorization: Bearer <CRON_SECRET>`. The web app then runs the four probes in parallel and stores
the results in `calldesk_status_checks`, which feeds `/status` and `/api/status`.

Why a Worker: it runs outside Fly, so a Fly outage cannot also stop the monitoring that reports it; it is
free-tier friendly (1,440 invocations a day); and the repo already uses Cloudflare. Fly scheduled machines
only go down to hourly, and a cron on the web app itself cannot report on its own death.

Limits to know: Cloudflare cron fires on a best-effort basis and can skip or delay a minute. The page
handles gaps honestly (a check older than 5 minutes shows "No recent data", and uptime counts completed
checks only). The Worker is a single point of failure for monitoring itself; if it stops, the page shows
"Status data is out of date" rather than green.

## Deploy (owner, once)

1. Apply `supabase/migrations/079_status_checks.sql` to the production Supabase project.
2. Make sure the web app (Fly app `calldesk-tech`) has `CRON_SECRET` set (it already does if the other
   `/api/cron/*` routes are in use) and `SUPABASE_SERVICE_ROLE_KEY`. Deploy the web app so `/api/status/probe` exists.
3. From this directory:
   ```
   npx wrangler login
   npx wrangler secret put CRON_SECRET     # paste the same value the web app uses
   npx wrangler deploy
   ```
4. Verify: `npx wrangler tail`, then open https://calldesk.tech/api/status after a couple of minutes.
   Test by hand: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://calldesk.tech/api/status/probe`
   (a request without the header must return 401).

The probe URL is the `PROBE_URL` var in `wrangler.toml`. Probe targets can be overridden on the web app with
`STATUS_WEB_BASE_URL`, `STATUS_ENGINE_URL` and `STATUS_TTS_URL` (defaults are the production hosts).
