# Tier-matrix benchmark (additive)

Sits alongside the original `bench/README.md` and its harness. Nothing here
replaces the published runs — the single-opponent harness
(`thunderphone-bench.sh` + `mystery-shopper-judge-neutral.mjs`) is untouched
and remains the way to reproduce the 2026-09-21 / 2026-09-26 results.

New files:

- `thunderphone-bench-tiers.sh` — runner that sweeps one or more ThunderPhone
  tiers per round and self-critiques our own transcript every round.
- `mystery-shopper-judge-pinned.mjs` — judge with a pinned, recorded model,
  a single-system `--critique` mode, and anti-anchoring guards. Same `--a/--b`
  interface and same seven criteria as the original judge, so scores stay
  comparable with the published runs.

## Why this exists

Three reasons, in order of how much they matter.

**1. "We beat Spark" is not the claim anyone cares about.** Spark is their
entry tier at 2¢/min, the one nobody would put on a medical call. A win
against Spark invites the obvious reply. The tier matrix runs Bolt (5¢) and
Storm (9¢) in the same pass, so the comparison is against the configuration
someone would actually deploy.

**2. A comparative judge only reports gaps on the loser.** When we win, the
harness produces no work — which is precisely when a second opinion is worth
the tokens. `--critique` scores one transcript on its own and always emits
concrete fixes.

This already paid for itself. On a sample booking transcript, the CalDesk call
that *won* an A/B scored **1/5** in critique mode. The comparative criteria
(turn efficiency, naturalness, closing quality) rewarded a confident, warm
close. The critique caught that the close confidently confirmed a 2 PM slot
the caller never agreed to, and that no service type was captured at all. That
is a booking that silently fails. **Winning the comparison and being right are
different properties — measure both.**

**3. The published report named a judge model the harness did not pin.** The
original judge prefers `claude -p` with no `--model` flag, so the model that
scored a run depended on the local session. It only ever printed "used claude
CLI" — never which model answered — while the report credited "Claude Sonnet
4-6 (via Anthropic API)", which is the *fallback* path. The new judge pins the
model, writes `JUDGE_MODEL` / `JUDGE_MODE` / `JUDGE_THINKING` into every
verdict file, and only uses the CLI when explicitly asked via `--use-cli`.

**4. "Extra Intelligence" has never been isolated.** Storm advertises 99.4%
accuracy, but that is measured on ThunderPhone's own BBA dataset (tagged audio
classification / question answering — not booking, slot capture, or correction
handling), and no Storm figure *without* Extra Intelligence is published
anywhere. The 99.4% therefore cannot be attributed to Extra Intelligence, and
ThunderPhone does not appear in the Cekura production-agent experiment either,
so there is no independent corroboration. A `<tier>-noei` entry closes that gap
ourselves: same tier, same prompt, Extra Intelligence the only variable.

## Extra Intelligence: how the pairing works

Add a second agent on the same tier with Extra Intelligence disabled, point a
second number at it, and name the tier `<tier>-noei`:

```bash
export THUNDERPHONE_TIERS="storm:+15550001111:125,storm-noei:+15550002222:126"
```

Two things then happen automatically:

- Each round runs the normal blind A/B (Calldesk vs that arm), so both arms
  still face an identical shopper.
- Each round *additionally* judges the two ThunderPhone transcripts **against
  each other** → `round-<r>-<tier>-eihead2head.txt`, summarised as an
  `EI-on wins / EI-off wins` table. This is the only comparison that answers
  "is Extra Intelligence worth its +3¢/min"; the per-round A/B answers "did we
  beat Storm" and cannot answer it, because the two arms never meet.

The head-to-head is an extra judge call per round and **no extra phone call**.
A `storm-noei` tier with no `storm` counterpart is allowed but warns, since the
delta is then uncomputable. `SKIP_EI_PAIR=1` turns the phase off.

## Setup

One ThunderPhone number per tier, each already pointing at that tier's agent.
A number can only face one agent, and the harness deliberately does not
re-point numbers at runtime because the `PATCH /v1/phone-numbers` payload
shape is still unverified — so map the numbers once in the dashboard and let
the harness only dial.

Create the agents via the API if you prefer:

```python
from thunderphone_api import create_agent

for tier in ("spark", "bolt", "storm"):
    agent = create_agent(
        name=f"calldesk-benchmark-{tier}",
        prompt="You are a friendly receptionist. Greet callers...",
        voice="john",              # see list_voices() for options
        product=tier,              # spark | bolt | storm
        primary_language="en",
    )
    print(tier, agent["id"])       # id is numeric, e.g. 123
```

Then:

```bash
export THUNDERPHONE_API_KEY="sk_live_..."
export THUNDERPHONE_TIERS="spark:+12025551111:123,bolt:+12025552222:124,storm:+12025553333:125"
export CALLDESK_NUMBER="+12245061194"
export TEST_CALL_SECRET="..."
export TWILIO_ACCOUNT_SID="..."
export TWILIO_AUTH_TOKEN="..."
export ANTHROPIC_API_KEY="..."      # or point CALLOOP_ENV at a .env
```

`THUNDERPHONE_TIERS` is a comma list of `tier:number:agent_id`; whitespace
around entries is tolerated. All three fields are required and the number must
be E.164, because a malformed spec used to be silently accepted and place a
live call to a bogus number. The legacy `THUNDERPHONE_NUMBER` +
`THUNDERPHONE_AGENT_ID` pair still works and is treated as a single `spark`
tier.

Each round's Calldesk business leg is resolved only from calls that started
inside that round's own time window, so a stale transcript from an earlier tier
or round can never be scored as this round's call. If the leg cannot be
resolved the round fails loudly instead of being judged on the wrong audio.

## Run

```bash
# all three tiers, 3 rounds each, medical scenario, thinking judge
SCENARIO=medical JUDGE_THINKING=1 ./thunderphone-bench-tiers.sh --rounds 3

# single opponent
./thunderphone-bench-tiers.sh --rounds 3 --tiers "storm:+12025553333:125"

# isolate Extra Intelligence: Storm as-sold vs the same tier with EI disabled
./thunderphone-bench-tiers.sh --rounds 5 --scenario medical \
  --tiers "storm:+15550001111:125,storm-noei:+15550002222:126"
```

Flags: `--rounds N`, `--tiers <spec>`, `--scenario <name>`, `--judge-model <id>`.
Env: `ROUNDS`, `SCENARIO`, `JUDGE_MODEL`, `JUDGE_THINKING`, `CALLOOP_ENV`,
`SKIP_CRITIQUE`, `SKIP_EI_PAIR`, `THUNDERPHONE_TIERS`.

Output lands in `/tmp/mystery-shopper-tp.XXXX`, keyed `round-<r>-<tier>-*`:

| file | what |
| --- | --- |
| `*-caldesk.txt` / `*-thunderphone.txt` | transcripts |
| `*-verdict.txt` | blind A/B verdict — `WINNER_SYSTEM`, `JUDGE_MODEL` |
| `*-critique.txt` | self-critique — the `## What to fix` section is the work list |
| `*-eihead2head.txt` | EI-on vs EI-off, paired tiers only |
| `*-caldesk-metrics.json` / `*-thunderphone-metrics.json` | objective audio latency |
| `*-biz-latency.txt` | our server-side latency, ours only |

The summary table prints winner, p50/p95 latency for both sides, and the count
of actionable fixes found by the critique.

## Scenarios

`booking` (default) — generic appointment booking.

`medical` — the caller spells their name out letter by letter unprompted, and
verifies the read-back. Models a clinic receptionist requirement where a
garbled name is unacceptable, and is the scenario to use when the objection is
"you'd never run the base tier for medical."

Passed through as the free-text `persona` field on `/place-test-call`, which
`call-loop-poc` already accepts per call — so adding a scenario needs no engine
change. Just add a case to `scenario_persona()` in the runner.

## Still unaddressed

- **Storm's extra intelligence is measured but still not matched.** The paired
  `-noei` arm tells us what Extra Intelligence is worth to *them*; it does not
  give us the capability. Storm pairs a fast model with a thinking model
  (`+3¢/min`). Selecting `claude-sonnet-4-6` on a flow node gives a larger
  non-thinking call, not a thinking+fast pair — the engine has no
  extended-thinking path, deliberately, until the tier matrix says it is worth
  one. Expect to lose on reasoning-flavoured evals, and say so in the report
  rather than hoping they come up.
- `PATCH /v1/phone-numbers` remains unverified, hence the dashboard mapping.
- The original harness still resolves Supabase credentials from a hardcoded
  `~/Documents/GitHub/realtime-tts/call-loop-poc/.env`. Only the new runner
  honours `CALLOOP_ENV`.
