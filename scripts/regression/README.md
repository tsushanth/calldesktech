# Builder regression (real calls)

Checks that what a user saves in the agent builder is what a caller experiences. Each scenario publishes one
version through the real API with one distinctive setting, routes a dedicated test number to it, has the AI
"shopper" phone that number, and asserts on what the engine logged for the call.

    npm run regression:builder                                  # DRY RUN: lists scenarios, checks config, shows the spend
    node scripts/regression/run.mjs --scenario handbook-secret --place-calls
    node scripts/regression/run.mjs --place-calls --max-calls 6

- **Costs money.** About $0.20 per call (two AI sessions plus two Twilio legs). The default is a dry run. A run refuses
  to start if it wants more calls than `--max-calls` (default 8), and every real call is counted in
  `~/.calldesk-regression-calls-used` (outside any worktree) against a lifetime cap (`TOTAL_CALL_CAP` in `lib.mjs`; raise it on purpose).
- **Setup:** `.env` needs `REGRESSION_NUMBER` (a Twilio number bought through the call engine's `/purchase-number`,
  about $1 a month), `CALL_LOOP_POC_BASE_URL`, `CALL_LOOP_POC_TEST_CALL_SECRET`, `NEXTAUTH_SECRET`,
  `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Secret values are never printed. Don't commit `.env`.
- **Who it runs as:** a throwaway tenant owned by `demo_e2e_regression`. User ids starting with `demo_` count as
  internal in every report, so none of this shows up as customer activity. Fixtures are created on first run.
- **It uses production** (the call engine lives there). The test number is only ever routed to the version under test.
- **Reading results:** `out/regression/<timestamp>.json` has each scenario's verdict, failures and transcript.
  A scenario with `knownIssue` is expected to fail; the run says "FIXED" when it starts passing.
- **Adding a scenario:** copy one in `scenarios.mjs`. Set ONE setting, make the caller persona short and
  deterministic, assert on a distinctive string or on duration. Run it once for real and read the transcript before
  trusting a pass (a check that matches too loosely passes for the wrong reason).
- **Known limits of the AI shopper:** it cannot stay silent (it says "Silence." out loud), so the silence hang-up
  scenario is skipped until a scripted TwiML caller exists. Skipped scenarios run only when named with `--scenario`.
- **Not observable from a transcript:** filler words and other audio-only behavior (the engine speaks them but they are
  not stored). Checking those needs a recording and a transcription step.
- **Known issues are scenarios too:** `knownIssue` marks a check that fails today (it is expected to); the run reports
  "FIXED" when it starts passing. Currently: `language-switch` (an English agent never hears a Spanish caller).
