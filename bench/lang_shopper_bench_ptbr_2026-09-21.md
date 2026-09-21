# Portuguese-Brazil (pt-BR) shopper bench (2026-09-21)

## What was added and where
On inspection, `pt-BR` support was **already fully implemented and committed** in both places before
this task began:
- `/Users/sushanthtiruvaipati/Documents/github/realtime-tts/call-loop-poc/languages.js` — `LANGS['pt-BR']`
  entry (name, `dg: { kind: 'flux', hint: 'pt' }`, backchannel/warmup/calendar/goodbye/transfer phrases in
  natural Brazilian Portuguese, `phoneAskRe`/`closingRe`), plus `ALIASES` mapping `pt`/`pt-br`/`pt_br` ->
  `pt-BR`. Last touched in commit `0e954b2` ("Use the ElevenLabs voice that exists on the account for
  non-English agents").
- `/Users/sushanthtiruvaipati/Documents/github/calldesktech/src/lib/languages.ts` — `AGENT_LANGUAGES`
  already lists `{ code: 'pt-BR', label: 'Portuguese (Brazil)', retell: 'pt-BR', stt: 'flux' }`, and
  `normalizeLanguage` already maps `pt`/`pt-br` -> `pt-BR`.
- `retellFlow.ts` `RETELL_VOICES['pt-BR']` was already present (`cartesia-Hailey-Portugese-Brazilian`).

No code changes were needed. Deepgram Flux multilingual v2 does cover Portuguese, so `dg.kind: 'flux'`
is correct (not a Nova-3 fallback).

## Deploy
`fly deploy --app call-loop-poc` run to push current `main` to production. Deploy succeeded, rolling
update completed, `fly status` showed the machine reaching `started` state and passing health checks.
(DNS propagation check threw a transient timeout warning, unrelated to app health.) calldesktech was not
touched (no code changes there), so it was not redeployed.

## Validation call
Minted temp API key, created a `receptionist` template agent (`voiceEngine:"poc"`, `language:"pt-BR"`),
routed phone `34d13af7-e4ba-4312-a0aa-bd8d356de97f` to it, placed a shopper call to +12245061194 via
`/place-test-call` with a Brazilian Portuguese persona (hair-cut shopper: pricing + booking this week).

- Twilio call sid `CAed9e88a85e99dd96664d17af403b47d7`, status `completed`, **duration 181s** (180s per
  our call log).
- Full transcript recovered from `calldesk_call_logs` (id `99aa50de-c093-4d62-b7d9-3d6465aa9016`).

## Assessment

**STT accuracy**: Good. The shopper's Portuguese utterances — including a spoken phone number
("21 9 8765-4321") and a name spelled aloud ("João, J-O-Ã-O") — were transcribed correctly and
consistently. One dropped/garbled turn ("Parece que cortou" / "você tá aí?") suggests a brief audio glitch,
not an STT-language issue — recovery was clean.

**Fluency**: Good. The agent's Portuguese was natural, colloquial Brazilian Portuguese throughout, no
English leakage, correct use of diminutives/politeness markers ("Beleza", "Tá bom", "Deixa eu confirmar").

**Task completion / graceful-degrade**: This is the interesting result. The agent did **not** have
pricing information and admitted it ("não tenho essa informação específica no momento") — but rather
than transferring and dead-ending (the old broken behavior), it pivoted to booking, matching the
Spanish/English fix verified earlier today. It also collected name and phone number and converged on a
concrete appointment slot (Tuesday Sept 25, 7pm) after negotiating around an initially wrong offered
slot (10am, which didn't match the caller's stated evening preference). **The graceful-degrade fix did
carry over to pt-BR correctly**, confirming the fix is genuinely language-independent as expected.

There was real friction in the flow, independent of language: it took the agent two exchanges to
capture what service was wanted, asked "did you manage to book?" as if talking to the caller about their
own action (likely a template phrasing artifact, not a translation bug), and repeated the caller's phone
number back incorrectly on the first attempt before self-correcting. These look like the same generic
`receptionist` template looseness observed in the Spanish/English benches, not new pt-BR-specific defects.

**Honest bottom line**: pt-BR passes — STT and fluency are solid, and the booking eventually resolved to
a concrete outcome, same shape as the fixed Spanish/English behavior. Task execution wasn't crisp (extra
back-and-forth, one confusing bot line, name/phone repeated for confirmation multiple times) but that's a
template/flow quality issue shared across all languages, not something specific to Portuguese.

## Cleanup
Phone number `34d13af7-e4ba-4312-a0aa-bd8d356de97f` `inbound_agent_version_id` reset to `NULL`, test
agent `b52ee6e3-95f8-480c-a4fd-1ca059ad3049` deleted, temporary API key row `6af68604-856d-4cdd-95d0-b88b67aea3c6` deleted. All confirmed via SQL return values.
