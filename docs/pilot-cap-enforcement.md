# Pilot cap enforcement

Status: implemented on both sides. The web app (this repo) maintains the block flag, refuses outbound calls for blocked tenants and keeps
blocked-call noise out of customer analytics. The voice engine (realtime-tts `call-loop-poc`, a separate repo) enforces the block on live
calls and the per-call time limit. One engine change, the spoken goodbye at the per-call limit, is still in progress; see "Per-call limit".

A pilot is a free one-week trial capped at `minutes_cap` talk minutes (default 50). The web app measures usage and decides whether the
pilot is over; the engine reads one boolean and obeys it.

## The block flag

Migration `068_pilots.sql` adds to `calldesk_tenants`:

| column | type | meaning |
| --- | --- | --- |
| `pilot_blocked` | boolean NOT NULL default false | true: this tenant's line is switched off |
| `pilot_blocked_reason` | text | `cap`, `expired` or `stopped` (null when not blocked) |
| `pilot_blocked_at` | timestamptz | when the flag was last set |

Tenants that are not pilots always have `pilot_blocked = false`, so neither side needs to know what a pilot is. `converted` pilots are
unblocked by the web side.

### Who sets it (hourly sync)

`POST /api/cron/pilot-watch` runs hourly (`.github/workflows/pilot-watch.yml`, `CRON_SECRET` bearer auth). For every pilot it:

1. Sums non-internal call minutes since `started_at` from `calldesk_call_logs`, ignoring calls the engine turned away (below).
2. Derives the status: `stopped` and `converted` are kept; otherwise `capped` when minutes used reach `minutes_cap`, `expired` when
   `now >= ends_at`, else `active`. It writes the status back when it differs.
3. Sets `pilot_blocked` to true for `capped`, `expired` and `stopped`, false otherwise, with the reason and time. It only writes when the
   value changes, and does nothing if the column does not exist yet (migration not applied).

The admin API (`PATCH /api/admin/pilots/[id]`) runs the same derivation immediately after Stop, Convert and Extend, so stopping a pilot blocks
it at once and extending it unblocks it at once. `?dry=1` reports what would change and writes nothing.

Latency: usage lags real calls by the call-log write delay plus up to an hour for the job, so the effective cap is `minutes_cap` plus
whatever is spoken before the next hourly run.

## Inbound calls to a blocked tenant (engine)

The engine reads `pilot_blocked` when it resolves the tenant for the dialed number. For a blocked tenant it does not run the agent flow. It:

1. Answers the call.
2. Speaks one neutral line in the agent's own voice, `PILOT_BLOCKED_MESSAGE`: "Thanks for calling. This line is not available right now.
   Please try again later." It never mentions a pilot, a cap or minutes: the caller is the pilot customer's customer.
3. Hangs up. A 10 second safety timer ends the call even if playback stalls; if text-to-speech fails the caller hears silence and the
   call is ended the same way.
4. Logs the call in `calldesk_call_logs` with `outcome = 'abandoned'`, `duration_seconds = 0` and `analysis = {"blocked": "pilot"}`.

Failure mode: if the flag cannot be read (database error, timeout, column missing before the migration) the engine serves the call as
normal. A pilot overshooting its free minutes by up to an hour costs little and the hourly job corrects it; dropping a paying customer's
calls because of a database blip would be a real outage.

### How blocked calls are treated

- Pilot usage, caps and alert emails ignore any call with `analysis.blocked` (`src/lib/pilots.ts`), so a blocked call neither adds minutes
  nor triggers a "short call" email.
- The dashboard shows them as a neutral "Blocked" badge (not the red "Abandoned"), keeps them in the Calls list under a Blocked filter, and
  leaves them out of customer-facing figures: the analytics outcome mix, answer rate and averages, Overview totals and average duration,
  and the quality-assurance resolution and unresolved rates. The shared check is `isPilotBlockedCall` in `src/lib/pilotBlockShared.ts`.

## Outbound calls from a blocked tenant

A blocked tenant must not place outbound calls either. The web app refuses before any carrier, Retell or engine request, with HTTP 403:

```json
{ "error": "pilot_blocked", "code": "pilot_blocked", "message": "Outbound calling is paused for this workspace ..." }
```

Entry points covered (all use `pilotBlockResponse` from `src/lib/pilotBlock.ts`):

- `POST /api/phone-numbers/[id]/call` (the Numbers page and test-call modal; also what the MCP `place_call` tool and the public API call)
- `POST /api/batch-calls/[id]/run` (manual run and the scheduled-batch cron; a refused batch stays `pending`)
- `POST /api/demo-call` with a `tenant_id`, and `POST /api/demo-call/live`

The MCP server forwards the refusal as a tool error that starts with `pilot_blocked:`; the dashboard shows the message text instead of the
raw code. The engine applies the same rule to outbound requests on its side, so a direct engine request is refused too.

Not tenant calls, so not gated: the anonymous marketing demo (`/api/demo-call` with a `profile_id`, no tenant) and the operator
softphone line (`/api/twilio/outbound-voice`), which dials from the operator's own caller IDs.

The check (`isTenantPilotBlocked`) fails open only when the `pilot_blocked` column does not exist (migration not applied, so nobody can be
blocked). Any other database error fails closed with HTTP 503 `pilot_check_failed`: a blocked tenant must never slip through because the
check could not run.

## Per-call limit

Pilot calls are limited to 10 minutes each (`PILOT_MAX_CALL_SEC`, 600 s), which bounds how far one call can run past the cap, since the
block flag is only read at call setup. At the limit the agent speaks a short goodbye and ends the call. This is an engine change that is
in progress; until it ships the engine's existing maximum call duration applies.

## Configuration and what is inert without it

| setting | where | without it |
| --- | --- | --- |
| `PILOT_WATCH_URL` | repo secret (e.g. `https://<app>/api/cron/pilot-watch`) | the hourly workflow exits without doing anything, so no status or flag syncing and no alerts |
| `PILOT_WEEKLY_REPORT_URL` | repo secret | the weekly digest workflow does nothing |
| `CRON_SECRET` | repo secret, same value as the app's `CRON_SECRET` | both workflows do nothing; the cron routes reject unauthenticated calls |
| `PILOT_ALERT_EMAIL` | app environment | alert and digest emails are not sent (and no sent-markers are written); the status and flag sync still runs |
| `RESEND_API_KEY` | app environment | same as above: no email |

Setting the flag by hand (`calldesk_tenants.pilot_blocked`) works without any of these; the job only keeps it in step with usage and dates.

## Test plan

- Blocked tenant, inbound: the call is answered, speaks the line, hangs up; no agent session or LLM requests; a call-log row with
  `analysis.blocked = 'pilot'` is written and does not count toward pilot usage.
- Blocked tenant, outbound: each entry point above returns 403 `pilot_blocked` and makes no provider request (`test/api/pilotOutboundBlock.test.ts`).
- Unblocked and non-pilot tenants: unchanged.
- Flag read fails or the column is missing: inbound is served; outbound is served only for the missing-column case.
- Analytics and dashboard exclude blocked calls (`test/api/pilotBlockedAnalytics.test.ts`, `test/lib/pilotBlock.test.ts`).
- Flip the flag with the web job, confirm the next call is blocked, then Extend in the admin page and confirm it is served again.
