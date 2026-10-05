# Real-call regression: schedule decision

Decision (2026-10-03): **do not run the regression nightly at the current capacity.** Revisit when the criteria below are met.

## What it is
`node scripts/regression/run.mjs --place-calls` places real phone calls against the live engine (18 scenarios: greeting, handbook, variables,
extraction flow, language switching, transfers, webhook/MCP function nodes, DTMF, voicemail, silence handling). `--list` shows them. A full run is
about $3.40 (about $0.20 per call, 17 calls). Options: `--scenario <id>`, `--max-calls <n>`, `--tier <t>` and `--voice <id>` (publish the test
version on a pricing tier / voice). The lifetime call counter lives in `~/.calldesk-regression-calls-used` and is capped (raised from 60 to 80 on
purpose, 2026-10-03; about 73 used when this was written), so every run spends a finite budget.

## Why not nightly now
- A nightly full run is about $100 a month and would use up the lifetime call cap in a few days.
- Traffic is small, so a manual run before risky changes catches almost everything a nightly run would.
- Each call also loads the real engine and voice services (Piper, Deepgram, the LLM), which is noise while capacity is being tuned.

## What to do instead
- Run it **manually before and after** changes to the voice engine, flow nodes, voices or tiers, and before promoting Lite.
- When the voice service looks unhealthy, run one English control scenario first (`--scenario exact-greeting`) before concluding anything.
- After any run that used `--tier` or `--voice`, check the regression number's inbound routing: the harness does not restore it.
- Ask before large batches; check the counter first.

## Revisit when any of these is true
- Paying Lite, Standard or Pro traffic is large enough that a silent engine regression would cost real money or customers.
- The per-run cost drops (cheaper voice and model, or a cheaper subset such as 5 to 6 core scenarios, about $1).
- The lifetime call cap is replaced by a monthly budget.

## If it becomes nightly
- Run a small core subset nightly (greeting, transfer, language switch, webhook function) and the full set weekly.
- Run it from the Mac mini or CI on a schedule with a monthly spend cap and an alert on failure.
- Make the harness restore number routing at the end of every run.
