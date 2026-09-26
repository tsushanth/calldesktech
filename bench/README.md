# bench/

Mystery-shopper A/B test harness comparing Calldesk's voice engine against
competitors for a given language/template.

## Retell benchmark (existing)

See `realtime-tts/call-loop-poc/scripts/mystery-shopper-run.sh` — the original
runner that swaps a shared Retell number between a benchmark agent and the live
Audexa DJ agent, places shopper calls, pulls transcripts, and runs a blind judge.

## ThunderPhone benchmark (new)

Files:
- `thunderphone-bench.sh` — main runner: places shopper calls against both
  Caldesk and ThunderPhone, pulls transcripts from both systems, derives audio
  latency, and runs the blind neutral judge.
- `thunderphone_api.py` — REST API wrapper for ThunderPhone (agent CRUD,
  number assignment, call listing/transcript retrieval).
- `mystery-shopper-judge-neutral.mjs` — generic blind A/B judge that accepts
  any two system labels (Calldesk vs ThunderPhone, Calldesk vs Retell, etc.).

### One-time setup

1. Sign up at https://app.thunderphone.com and create a benchmark agent
   with the same behavior/prompt as the Caldesk agent you want to test.
2. Buy a ThunderPhone number (or BYO SIP) and point it at that agent.
3. Generate an API key (Dashboard → Settings → API Keys).
4. Export the credentials:
   ```bash
   export THUNDERPHONE_API_KEY="sk_live_..."
   export THUNDERPHONE_NUMBER="+12025551234"
   export THUNDERPHONE_AGENT_ID="123"       # numeric id from the agent object
   export CALLDESK_NUMBER="+12245061194"    # or your inbound Caldesk number
   export TEST_CALL_SECRET="..."
   export TWILIO_ACCOUNT_SID="..."
   export TWILIO_AUTH_TOKEN="..."
   ```
   Note: `THUNDERPHONE_AGENT_ID` is the numeric `id` field (e.g. `123`), not
   a string like `ag_...`.

### Creating the benchmark agent via API (optional)

If you prefer to create the agent programmatically instead of in the dashboard:

```python
from thunderphone_api import create_agent

agent = create_agent(
    name="calldesk-benchmark",
    prompt="You are a friendly receptionist. Greet callers...",
    voice="john",              # see list_voices() for options
    product="spark",           # spark | bolt | storm
    primary_language="en"
)
print(agent["id"])  # use this for THUNDERPHONE_AGENT_ID
```

### Run

```bash
./thunderphone-bench.sh --rounds 3
```

Output: per-round transcripts, objective latency JSON, blind judge verdicts,
and a summary table in `/tmp/mystery-shopper-tp.XXXX`.

### API validation status

The `thunderphone_api.py` wrapper has been validated against a live
ThunderPhone account:

- ✅ `GET /v1/agents` — list agents
- ✅ `POST /v1/agents` — create agent (`prompt`, `voice`, `product`, `primary_language`)
- ✅ `DELETE /v1/agents/{id}` — delete agent (numeric id)
- ✅ `GET /v1/calls` — paginated (`{"results": [...], "total", "limit", "offset"}`)
- ✅ `GET /v1/voices` — list voices
- ✅ `GET /v1/phone-numbers` — list numbers
- ⚠️ `PATCH /v1/phone-numbers/{id}` — assumed shape (not tested, no numbers on account)
