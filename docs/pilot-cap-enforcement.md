# Pilot cap enforcement (spec for the voice engine)

Status: DRAFT SPEC. The web side (flag maintenance) is implemented in this repo; the engine side is NOT implemented and lives in the
realtime-tts `call-loop-poc` repo. Nothing here is deployed. The engine file names below (`tenantLookup.js`) come from the task brief and
were not re-read while writing this; verify them before implementing.

A pilot is a free one-week trial capped at `minutes_cap` talk minutes (default 50). The web app measures usage and computes whether the
pilot is over; the engine only has to read one boolean at call setup and obey it.

## Contract between web and engine

Migration `068_pilots.sql` adds to `calldesk_tenants`:

| column | type | meaning |
| --- | --- | --- |
| `pilot_blocked` | boolean NOT NULL default false | true: do not run the agent for this tenant |
| `pilot_blocked_reason` | text | `cap`, `expired` or `stopped` (null when not blocked) |
| `pilot_blocked_at` | timestamptz | when the flag was last set |

Tenants that are not pilots always have `pilot_blocked = false`, so the engine needs no knowledge of what a pilot is, and `converted`
pilots are unblocked by the web side.

## Engine behaviour at call setup

`tenantLookup.js` already resolves the tenant and agent for each inbound call from the dialed number. Add `pilot_blocked` and
`pilot_blocked_reason` to the columns it reads from `calldesk_tenants` (same query, no extra round trip, and cache it with the existing
tenant cache only if that cache TTL is 60 s or less, otherwise bypass the cache for this field).

If `pilot_blocked` is true:

1. Do not start the realtime agent session, STT/TTS or LLM. A blocked call must cost close to nothing.
2. Answer the call and play one pre-rendered (not synthesized per call) message, under 10 seconds:
   "Thanks for calling. This line's assistant is not available right now. Please try again later or call the business directly."
   Use a static audio file or `<Say>`, never the agent voice stack. Do not mention a pilot, a cap or minutes: the caller is the pilot
   customer's customer.
3. Hang up after the message. Do not forward or take a voicemail in v1: a voicemail would need storage and a follow-up path for
   what is a free trial, and the pilot customer can keep a carrier-side fallback on their own phone. (If tenants later get a
   `fallback_number`, `<Dial>` it instead of hanging up.)
4. Log the call in `calldesk_call_logs` with `outcome = 'abandoned'`, `duration_seconds` equal to the message length, and
   `analysis = {"blocked": "pilot"}`. The web side ignores calls with `analysis.blocked` for usage, the cap and alerts, so blocked
   calls neither add minutes nor trigger "short call" emails (they remain visible in the tenant's call log).

## Mid-call overrun

The flag is only read at call setup, so a call that starts at 49 minutes can run past the cap. Accept that, but bound it: calls for a
pilot tenant should also be limited to 10 minutes each (`min(existing max call duration, 600 s)`), which caps the overshoot per
concurrent call. To know that a tenant is a pilot the engine needs one more read in the same lookup: `is_pilot`, true when a
`calldesk_pilots` row exists for the tenant and its status is not `converted`. This is optional for v1; without it the existing
max call duration applies.

## Failure mode: fail open

If the flag cannot be read (database error, timeout over 500 ms, column missing before the migration), the engine serves the call as
normal. Reasons:

- A pilot overshooting its free minutes by some hours costs little and is capped anyway by the hourly web job; a paying customer's
  calls being dropped by a database blip is a real outage and a trust problem.
- The web side re-derives the flag every hour, so a missed block is corrected within the hour.
- Log a warning with the tenant id when failing open so repeated failures are noticed.

Fail closed is only appropriate if free minutes ever carry a hard cost ceiling that overshoot would breach; revisit if pilots get
a metered upstream provider budget.

## Web-side job that maintains the flag (implemented)

`POST /api/cron/pilot-watch` (hourly via `.github/workflows/pilot-watch.yml`, `CRON_SECRET` bearer auth) for every pilot:

1. Sums non-internal call minutes since `started_at` from `calldesk_call_logs`.
2. Derives status: `stopped` and `converted` are kept; otherwise `capped` when minutes used >= `minutes_cap`, `expired` when
   `now >= ends_at`, else `active`. It writes the status back when it differs.
3. Sets `calldesk_tenants.pilot_blocked` to true for `capped`, `expired` and `stopped`, false otherwise, with the reason and time.
   It only writes when the value changes, and does nothing if the column does not exist yet (migration not applied).

The admin API (`PATCH /api/admin/pilots/[id]`) runs the same derivation immediately after Stop, Convert and Extend, so stopping a
pilot blocks it at once and extending one (more days or minutes) unblocks it at once, without waiting for the hourly job.

`?dry=1` reports the status and flag changes it would make and writes nothing.

Latency: usage lags real calls by the call-log write delay plus up to an hour for the cron, so the effective cap is
`minutes_cap` plus whatever is spoken between the cap being crossed and the next hourly run. At typical pilot volumes that is a few
minutes. If that is too loose, the engine can also check the cap itself at setup (sum of the tenant's `duration_seconds` since the
pilot started, one indexed query on `tenant_id, created_at`) and treat that as an additional block condition; not required for v1.

## Test plan for the engine change

- `pilot_blocked = true`: call gets the message and hangs up; no agent session, no LLM or TTS requests; a call-log row is written.
- `pilot_blocked = false` and non-pilot tenants: unchanged.
- Flag read fails or times out: call is served and a warning is logged.
- Column missing (pre-migration): call is served.
- Flip the flag with the web job and confirm the next call is blocked and, after Extend in the admin page, served again.
