# Voice agent evaluation framework — design

Status: approved, implementation starting 2026-09-21.

## Purpose

A repeatable testing/evaluation system for the CallDeskTech voice platform, run on-demand, on a
weekly schedule, and on every deploy. It places real phone calls against our own agents (and,
occasionally, Retell's for external comparison), scores the results, tracks them over time, and
alerts us when something regresses — so we can decide how to improve the platform from real
evidence instead of ad hoc manual test calls that get lost between sessions.

The primary objective is **catching our own regressions and driving improvement of our platform**.
Comparison against Retell is a secondary, occasional data point (full/weekly tier only), not the
framework's core purpose — this framework does not exist to keep score against a competitor.

This formalizes and generalizes work already done ad hoc today: the mystery-shopper harness
(`bench/sq.sh`, real shopper calls via `/place-test-call`), LLM-judged transcript scoring, and the
lesson (re)learned today that anything valuable must be committed to git, not left in the session
scratchpad.

## Non-goals

- Not a load-testing or chaos-engineering tool — one call at a time, sequentially (Twilio's 1
  call/sec cap), not concurrency/scale testing.
- Not a CI unit-test replacement — this tests real conversational behavior over real phone calls,
  not code correctness.
- Not a blocking deploy gate — a bad run never stops or rolls back a deploy. It reports.
- Not primarily a Retell benchmarking tool — see Purpose above.

## Triggers

1. **On-demand** — run the script manually with a tier flag.
2. **On-deploy** — `bench/deploy-and-test.sh` wraps `fly deploy` (for `call-loop-poc` and/or
   `calldesk-tech`), waits for the deploy to report healthy, then runs the fast tier. This script
   becomes the normal way we deploy going forward, replacing bare `fly deploy` calls where this
   framework is meant to run.
3. **Weekly schedule** — a GitHub Actions cron calls the runner directly with `tier=full
   --vs-retell`, skipping the deploy step entirely (it tests whatever's currently in production).

All three triggers are **non-blocking**: they report, they never stop or roll back a deploy.

## Tiers

| | Fast | Full |
|---|---|---|
| Trigger | on-deploy, on-demand (default) | weekly cron, on-demand with `--vs-retell` |
| Case count | ~3 (from `eval-cases.json`, `tier: "fast"`) | full case set (`tier: "full"`, or all cases) |
| Compares against | our own last run for that case (baseline) | our own last run **and** Retell (real calls both sides) |
| Approx cost | ~$0.20–0.30/run | proportional to case count × ~$0.70/pair (ours + Retell) |
| Approx time | under a minute of call time | minutes, scales with case count, run sequentially |

On-demand runs can force either tier and can force `--vs-retell` regardless of tier, so a Retell
comparison is always available when explicitly wanted, without being the default cost of every run.

## Components

1. **Test case registry** — `bench/eval-cases.json`, git-tracked, hand-edited. Each entry:
   ```json
   { "id": "receptionist-en-pricing", "template": "receptionist", "language": "en",
     "persona": "...", "tier": "fast" }
   ```
   Adding/removing coverage is a normal git diff, reviewable like any other change.

2. **Runner** — extends today's `shopper_bench.py` / `judge_all.py` pattern into a single script
   (`bench/run_eval.py` or similar) that: takes `--tier fast|full` and optional `--vs-retell`;
   reads matching cases from the registry; for each case, places a real shopper call against our
   number (routed to a fresh instance of that case's template+language, cleaned up after), and —
   only if `--vs-retell` — an equivalent call against Retell; pulls each transcript; scores with an
   LLM judge on: task completion, fluency, latency, and barge-in handling where the call structure
   allows testing it; computes a regression signal both ways:
   - **Numeric**: compare each sub-score against that same case's most recent prior run — flag if
     task-completion drops, or latency p50 rises meaningfully (exact thresholds tuned after the
     first few real runs establish a noise floor).
   - **Holistic**: the LLM judge also gets the prior run's transcript+scores side by side with
     today's and is asked directly "better, worse, or same, and why" — this note is stored and
     surfaced alongside the numeric flag, not used alone to gate anything.
   Every call sequence cleans up after itself (clear phone routing, delete test agents, revoke temp
   API keys) in a `finally`-equivalent block, so a mid-run crash can never leave production routing
   pointed at a test agent.

3. **Storage** — two new Supabase tables:
   - `calldesk_eval_runs`: one row per run — `id, tier, trigger (on-demand|on-deploy|weekly),
     vs_retell bool, started_at, finished_at, status (ok|crashed), regression_count, error_count`.
   - `calldesk_eval_cases`: one row per test case per run — `run_id, case_id, template, language,
     status (scored|errored), scores (task_completion, fluency, latency_ms, barge_in), delta_from_prior,
     regressed bool, llm_notes, transcript, retell_scores (nullable), retell_transcript (nullable)`.

4. **Notifier** — reuses the existing SMS path (`ALERT_SMS_TO`/`ALERT_SMS_FROM`, already wired for
   the Kokoro-failover alert in call-loop-poc) via the same Twilio Messages API call shape. Sends:
   - A short "N regressions in <tier> eval run, see <dashboard link>" when `regression_count > 0`.
   - A distinct "eval run after deploy did not complete" if the runner crashes/errors out entirely
     (so silence is never mistaken for "all clear").
   - For the weekly full run specifically: always sends a summary (pass or fail), since it's
     infrequent enough that a confirmation it ran at all has value.
   A high per-run error_count (calls that failed to complete, not quality regressions) is mentioned
   in the notification text when it's large, but does not itself count as a regression.

5. **Dashboard** — new page `/admin/eval`, same admin-email allowlist gate as the existing
   `/admin/usage` page. Shows: run history (list, filterable by tier/trigger), each case's score
   trend over time (so a slow drift is visible, not just single-run regressions), and the ability to
   drill into any run/case to read its full transcript and LLM notes.

## Data flow (fast tier, on-deploy example)

1. `deploy-and-test.sh` runs `fly deploy --app <app>`, waits for the machine to report healthy.
2. Invokes the runner with `--tier fast`.
3. Runner reads the fast-tier cases from `eval-cases.json`, places one real shopper call per case
   against our number, pulls the transcript, judges it, looks up that case's most recent prior score
   from `calldesk_eval_cases` to compute the delta.
4. Runner writes one `calldesk_eval_runs` row and N `calldesk_eval_cases` rows.
5. If any case regressed, sends the SMS.
6. Dashboard reads directly from the two tables — no separate aggregation job.

The full/weekly path is the same shape, reading the full case set and adding the Retell leg per
case, and always notifying (not just on regression).

## Error handling

- **Call fails to complete** (busy, no-answer, Twilio error, TTS-gateway-down, etc.) — case recorded
  as `errored`, not silently dropped and not counted as a quality regression.
- **Runner crashes mid-run** — logs clearly, does not block or fail the deploy; triggers the
  distinct "didn't complete" alert described above.
- **Cleanup** — always runs, even on crash, so no test agent is ever left routed on a real
  production number.
- **Retell-side issues** (their API, rate limits) — out of scope for careful handling. If a Retell
  leg fails, that case's Retell comparison is simply marked unavailable; no retry logic, no special
  alerting. This framework's job is our own platform, not Retell's uptime.

## Rollout

1. Build the registry, runner, and Supabase tables.
2. Dry-run the fast tier manually several times against current production, sanity-check scores
   against what a human reading the transcripts would conclude, before wiring into anything
   automatic.
3. First fast-tier run has no prior score to diff against — establishes baseline only, no regression
   check possible until run #2 for each case.
4. Wire in `deploy-and-test.sh` once the manual runs are trusted.
5. Add the weekly GitHub Actions cron last (most expensive/infrequent to validate).
6. Build `/admin/eval` dashboard (can happen in parallel with 2-5 once storage exists).
