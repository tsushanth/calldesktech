# bench/

Mystery-shopper A/B test harness comparing our voice engine (call-loop-poc) against Retell for a
given language/template. Committed to git (not the session scratchpad) specifically so it survives
session restarts — a prior version of this lived only under /tmp and was lost.

- `sq.sh <sql>` — run SQL against the production Supabase project via the Management API
  (uses the Supabase CLI's cached token from macOS Keychain; nothing hardcoded).
- `lang_shopper_bench.py` — places one real shopper call against our number and one against Retell's
  number, in a given language, and saves both transcripts + timing to `results/`.
- `results/` — raw call transcripts and per-run JSON (gitignored; regenerate by re-running).

Needs in the environment/`.env` at repo root: TWILIO_ACCOUNT_SID/AUTH_TOKEN, RETELL_API_KEY,
TEST_CALL_SECRET (call-loop-poc's /place-test-call secret), ANTHROPIC_API_KEY (LLM judge).
