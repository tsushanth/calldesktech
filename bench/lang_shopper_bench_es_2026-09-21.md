# Spanish A/B: ours vs Retell (2026-09-21)

Real calls, no synthetic data. Harness: `/place-test-call` shopper mode dialing our number
(+12245061194, routed to a fresh `receptionist` template agent, `language:"es"`) and Retell's
number (+19786454307, routed to the parity Retell agent Retell's `language: es-419`, created via
our own `voiceEngine:"retell"` from-template path). Same shopper persona/goal on both: ask about
pricing and try to book an appointment this week, natural colloquial Spanish.

## Setup bug found and fixed along the way
Routing a Retell phone number to a freshly-created agent via `PATCH /update-phone-number` with the
deprecated `inbound_agent_id` field silently no-ops (Retell rejects it, but our code path — and the
first attempt here — didn't publish the agent first). Correct sequence: `POST /publish-agent/<id>`
then `PATCH /update-phone-number` with `inbound_agents: [{agent_id, agent_version, weight:1}]`
(see `src/lib/retell.ts assignPhoneNumberToAgent` — that helper already does this right; the bug was
in doing it by hand for a one-off test agent).

## Result: task completion — Retell won this call

| | Ours | Retell |
|---|---|---|
| Duration | 91s | 58s |
| Fluency (LLM judge, 1-5) | 4 | 5 |
| Task completion (1-5) | **1** | 3 |
| Caller experience (1-5) | 2 | 4 |

Transcripts: both agents opened naturally in Spanish and stayed in-language throughout — no English
leakage on either side, confirming the multilingual STT/TTS/prompt pipeline works.

**But ours failed the actual task.** The shopper asked what services/pricing were available; our
`receptionist` template agent didn't have that information in its flow/KB, said so honestly five
times, and transferred the call without giving the caller anything. Retell's parity agent, given the
*same generic template content*, booked a concrete appointment (Wednesday 10:30am) though it also
never answered the pricing question.

This is very likely **not a language bug** — it's the `receptionist` template's flow/KB content being
too generic to answer specifics, independent of language, and Retell's agent handling "no information
available" more gracefully (offering to book anyway) rather than transferring immediately. The gap is
real and worth a follow-up: is this a language-specific flow issue (translated template prompt lost
guidance the English one has) or would English hit the same wall on this template? Not established
either way — need an English A/B on the same template to isolate it.

## Latency

| | Ours (ElevenLabs, es) | Retell (es-419) |
|---|---|---|
| Response (LLM+TTS), median | ~1.1-1.3s (turn responseMs) | e2e p50 1258ms |
| Response, p95-ish | ~1.3s | e2e p95 1358ms |
| LLM-only | ~650-700ms ttfb | llm p50 719ms |

Roughly comparable, no clear winner. Both in the 1-1.4s range for a full turn.

## Barge-in / interruption

**Not exercised.** Neither shopper call happened to interrupt mid-sentence, and I didn't script a
forced interruption for this pass. The interruption-handling code (`_resolveInterruptionSensitivity`)
is entirely language-agnostic — it operates on turn/audio state, not transcript content — so there's
low a priori risk of a language-specific bug there, but that's an argument from code reading, not a
verified result. Flagging as still open.

## Outbound-direction test

**Attempted, not meaningfully completable.** Placed a real outbound call from our number in Spanish
mode to a number we control (+18559152245, our own demo caller-ID number) — there was no live person
or shopper-mode listener on the other end to answer and converse, so it just returned `busy`/no
answer. Validating our *outbound* Spanish flow needs either a second shopper-capable receiving
endpoint or a human to actually answer — neither was available this pass. The outbound code path
(`_speak`, TTS backend selection, language prompt) is identical to inbound once the call connects, so
risk is believed low but this is unverified.

## Cleanup
All test agents (ours ×2, Retell ×1), phone-number routing (inbound + outbound), and temporary API
keys were removed/revoked after each test. Verified via SQL that `inbound_agent_version_id` and
`outbound_agent_version_id` are both NULL again on +12245061194, and Retell's number has an empty
`inbound_agents` list.

## Bottom line
Spanish STT/LLM/TTS pipeline itself works correctly and matches Retell on fluency and latency. The
real, measured gap is task completion on this specific template/flow, not the language layer — and
that gap favors Retell. Needs a flow-content fix (give the `receptionist` template real service/price
info, or make the "I don't know" path try to still offer a booking like Retell's does) rather than a
language-layer fix. Barge-in and outbound-direction remain unverified with real calls.
