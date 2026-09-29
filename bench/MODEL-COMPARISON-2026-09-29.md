# LLM model comparison for call-loop-poc's flow engine — 2026-09-29

Same motivation as `TIER-BENCH.md`'s tier matrix, one layer down: instead of
comparing whole competitor products, this compares candidate **LLMs** for
call-loop-poc's own flow-node reasoning layer (`server.js`'s
`_generateTurn`), which today defaults to `claude-haiku-4-5-20251001`. The
question: is there a cheaper or better-performing model worth swapping in,
per node, without touching what every other tenant already gets.

Everything here is real, run-today findings, not benchmark scores — every
number came from an actual live phone call through the medical-booking test
flow (see "Test harness" below), not an offline eval.

## Models tested

| Model | Provider | Notes |
| --- | --- | --- |
| `claude-haiku-4-5-20251001` | Anthropic | current production default |
| `gpt-6-luna` | OpenAI | |
| `openai/gpt-oss-120b` | Groq-hosted | open-weight, hosted (not self-hosted) |
| `qwen2.5-7b-instruct-selfhosted` | Modal, our own A10G | genuinely self-hosted |
| `qwen2.5-32b-instruct-selfhosted` | Modal, our own A100-80GB | genuinely self-hosted |

Not yet tested: Claude Sonnet 4.6 (available, untested this round), any
speech-to-speech model (see "Speech-to-speech" section — infra exists,
untested).

## Engineering work required to make this testable at all

None of this comparison was possible without real engineering first —
worth recording since it's reusable for the *next* model tried, not just
these five.

1. **`server.js` had no multi-provider path.** The LLM layer was hardcoded
   to `@anthropic-ai/sdk` calls at ~10 sites. Added a provider-agnostic
   adapter (`runOpenAiCompatibleTurn`, `MODEL_PROVIDER`,
   `OPENAI_COMPAT_ENDPOINT`/`OPENAI_COMPAT_KEY` maps) that normalizes any
   OpenAI-compatible endpoint (OpenAI, Groq, or our own Modal deployments)
   to the same `{content, usage}` shape Anthropic's SDK already returns,
   scoped to the main turn-generation call site only (calendar/subagent
   tool sites elsewhere still assume Anthropic).
2. **OpenAI-style Chat Completions APIs don't interleave speech with tool
   calls the way Anthropic's API does.** A turn that calls `record_field`
   comes back with `content: null` on Luna, Groq's gpt-oss-120b, and our
   self-hosted Qwen2.5-7B — silently dropping this flow's "always say
   something out loud too" requirement. Fixed with a follow-up round-trip
   (`runOpenAiCompatibleTurn`'s two-pass logic): if a turn produces tool
   calls but no text, immediately re-request with synthetic tool results
   appended, asking the model to speak. Real cost: one extra full
   round-trip of latency on any turn that extracts a field, on every model
   except Qwen2.5-**32B**, which returned both together natively (see
   results table).
3. **vLLM 0.6.3 has a real upstream bug**: `build_guided_decoding_logits_processor_async`
   unconditionally imports `outlines.types.airports` -> `pyairports.airports`
   on *every* `/v1/chat/completions` request, tool call or not. The
   `pyairports` actually published on PyPI (`0.0.1`) is an unrelated,
   incompatible package with no such module — every request 500'd until a
   stub module (`AIRPORT_LIST = []`) was baked into the image. No known-good
   `pyairports` version exists to pin instead; the real fix if this
   recurs is bumping vLLM past whatever version decoupled this from
   `outlines`, not re-adding the flags. See `worker-modal-llm/app.py` and
   `app_32b.py`.
4. **The TTS gateway's documented 20s WS heartbeat never actually
   existed.** `DECISIONS.md` claimed one was added to beat the Cloudflare
   edge proxy's (`tts.readaloudai.org`) idle-timeout, but `grep`ing
   `server.js` for it came up empty. This was the root cause of repeated
   `kokoro TTS unavailable (gateway closed mid-turn)` / `tts gateway warm
   (dial) timed out after 45002ms` failures blocking every call attempt
   that day, independent of anything LLM-related. Fixed: a real 20s
   `ws.ping()` interval, wired into both the pre-call warm socket and the
   active-call socket.
5. **The shopper-mode role-confusion bug**: `SLOT_SAFETY_INSTRUCTION`
   (written entirely from the business agent's point of view — "never
   state a detail *the caller* has not told you") was appended to every
   turn's prompt with no `isShopper` gate, unlike every other
   shopper-aware branch in the file. On a shopper call, this told the
   shopper's own LLM to behave like the one *collecting* fields, not the
   one answering — reproduced live as both legs of a test call
   simultaneously asking each other for the caller's name/time/number.
   Fixed by gating it: `this.isShopper ? '' : SLOT_SAFETY_INSTRUCTION`.
6. **`demoFlow` and `shopper:true` can't be combined** — `server.js`'s
   `voiceUrl` ternary picks `isDemo` over `shopper`, so a call meant to
   run a custom flow as "the shopper" instead ran it as "the business,"
   while the real inbound leg silently fell back to whatever tenant flow
   was already configured for the dialed number. Real production-flow
   exposure risk, not just a test artifact. Fixed downstream, not in
   `server.js`: a **dedicated test tenant** was created instead (tenant
   `bd2bd485-4448-42fc-8972-69791784d167`, flow
   `8af97c97-bc8f-4343-8d15-9074d1f127e1`, bound to a previously-unused
   Twilio number `+12708187836`) so `shopper` and a custom flow can be
   exercised together correctly, through real tenant routing instead of
   the ephemeral `demoFlow` mechanism.

## Test harness

Medical-booking flow (`greeting -> booking (extraction) -> confirmation ->
goodbye`), bound to the dedicated test tenant above. An automated "shopper"
persona plays a caller who spells their name unprompted and deliberately
misreads a 10-digit callback number 2-3 times before giving it correctly —
the same adversarial pattern already established in
`thunderphone-bench-tiers.sh`'s `medical` scenario, reused here to test the
LLM layer specifically rather than a competitor product.

**Sample size caveat, stated plainly**: every result below is N=1 per
model per prompt version. This is enough to catch a reproducible failure
mode (which is what happened — see Qwen 32B) but not enough to establish a
reliable base rate for any model. Treat every number here as a lead worth
following up, not a settled conclusion.

## Results

| Model | LLM TTFB (warm) | Speech + tool calls in one response? | Extracted all 3 fields correctly | Confirmation readback restated all 3 fields |
| --- | --- | --- | --- | --- |
| Haiku | 520–1700ms | yes (native) | yes | yes |
| Luna | 1400–2340ms | no (needs follow-up turn) | yes | didn't reach confirmation before shopper's 3-min window ran out |
| Qwen2.5-7B (before prompt fix) | 500–2300ms | no (needs follow-up turn) | yes | **no — dropped the callback number from the readback and closed the call** |
| Qwen2.5-7B (after prompt fix) | 550–1050ms | no (needs follow-up turn) | yes | **yes — held the rule across 3 separate confirmation attempts** |
| Qwen2.5-32B | 480–550ms (fastest tested) | **yes (native)** | yes | **no — dropped BOTH the name and the callback number**, worse than 7B's original bug, despite the identical strengthened prompt |
| gpt-oss-120b (Groq) | n/a — never spoke | no (never fixed) | **no — only 1 of 3 fields, and follow-up-turn fix didn't help this specific model** | not reached |
| Qwen3-32B (thinking disabled) | 538–678ms (fastest and most consistent of everything tested) | yes (native, once thinking disabled — see below) | yes | not reached (shopper's 3-min window ran out) — but see the false-rejection note below |

**Qwen3-32B needed its own separate fix before it was even usable**: by
default it's a reasoning model, and its entire `<think>...</think>` chain
of thought leaked directly into the `content` field — the same field that
gets spoken to the caller — burning the whole token budget on internal
monologue with `reasoning_content` left `null` (no parser configured).
Fixed with `chat_template_kwargs: {enable_thinking: false}`, a request-time
param Qwen3's own chat template respects; verified live to produce clean
speech + tool calls together afterward. Getting a working deployment at
all took five dependency-hell iterations first (`vllm==0.6.3` doesn't
recognize the `qwen3` architecture at all; `vllm==0.9.2`'s vendored
`ovis.py` config collides with `aimv2` regardless of which `transformers`
version is paired with it; `vllm==0.11.0` unpinned resolved a `transformers`
past a breaking tokenizer-API change vLLM's own tokenizer loader still
called; pinning to vLLM's own declared floor, `transformers==4.55.2`, fixed
that; and vLLM 0.11.0's default `torch.compile`/CUDA-graph capture across
~69 batch sizes — a throughput optimization irrelevant to single-request
voice serving — took long enough to blow past Modal's fixed 300s
container-init check regardless of this function's own `startup_timeout`,
fixed with `--enforce-eager`).

**A new, different correctness gap from Qwen2.5-32B's**: at one point in
the live call the shopper read the callback number back **correctly**
("4 1 5 5 5 5 0 1 4 7" — exactly `4155550147`, the number specified in its
own persona), and Qwen3-32B rejected it as wrong anyway, before correctly
catching two subsequent *actually* wrong readbacks. Excellent persistence
against bad data (never once accepted a wrong number across four attempts,
the best result of any model tested), but this is the opposite failure
mode from the acceptance-side gaps found in Haiku/Luna/Qwen2.5 testing — a
model that can be too suspicious of correct data, not just too permissive
of wrong data. Confirmed from the stored `calldesk_call_logs.transcript`,
not just server logs.

**The counterintuitive finding worth flagging on its own**: the 32B model
was the fastest of everything tested and the only one to interleave speech
with tool calls the way Anthropic's models do — a genuine architectural
win. But given the *exact same* strengthened confirmation-node prompt that
fixed the 7B's behavior, it followed the explicit "restate all three
fields" rule *worse*, not better. Bigger did not mean more compliant here.
Full transcript confirms it never read back the callback number at any
point in the call, not just at the final confirmation step (pulled from
`calldesk_call_logs.transcript`, not just server logs, to rule out a
log-truncation artifact).

## The confirmation-node prompt fix (for reference)

Applied to the test flow's `confirmation` node (Supabase
`calldesk_conversation_flows` row `8af97c97-bc8f-4343-8d15-9074d1f127e1`),
not yet applied to any real tenant's flow — this only matters when a flow
actually swaps its LLM to a non-Haiku model:

> Your readback sentence MUST explicitly restate ALL THREE values (name,
> time, callback number) together in the SAME sentence, every single time
> you say it — even if one or more fields were already individually
> corrected earlier in the call. Do NOT treat an earlier per-field
> correction (e.g. a caller correcting a misheard digit) as satisfying
> this requirement. [...] Before calling transition_flow, check your own
> last sentence: if it does not contain the name AND the time AND the
> callback number, you have NOT asked for confirmation yet[.]

This fixed Qwen2.5-7B completely (3/3 held) and did not fix Qwen2.5-32B
(0/1 — dropped two of three fields anyway). Whatever's causing the 32B
model to ignore this instruction is not yet understood — worth a follow-up
investigation before trusting 32B on this flow regardless of its latency
and native tool+speech advantages.

## Is the "multiple LLMs listening/agreeing beats one" claim true?

Prompted by a specific claim on
[thunderphone.com/technology](https://thunderphone.com/technology).
Their actual claim is **multi-model consensus at the STT/transcription
stage** (three parallel transcripts, "2 of 3 agree"), not live LLM
turn-generation ensembling — this is the well-established technique
(ROVER-style ASR consensus voting), and is cheap/parallel/practical, unlike
running 2-3 full LLM turns per response, which no real vendor or paper
supports doing live under a sub-2s budget (checked: MoA, multi-agent
debate, and LLM-judge-ensemble papers all either take multiple sequential
rounds or run post-hoc on a transcript, never live per-turn). Their cited
BBA benchmark (99.4%) is the same dataset already flagged in
`TIER-BENCH.md` as not actually measuring booking/slot-capture performance.
Their own stated latency (2-3s) is slower than the sub-2s target this repo
holds itself to.

**A concrete, buildable version of the "agree" idea that fits what we
actually have**: not live in-turn ensembling, but a post-hoc validity gate
specifically on `confirmation`-type nodes — after the primary model's
readback is spoken, fire 1-2 secondary models in parallel (off to the side
of TTS playback, so no perceived latency cost) asking "was field X restated
correctly?" per required field, and block the transition to `goodbye`
unless every validator confirms every field. Designed but **not built** —
the recommendation was to try a stronger prompt first (which worked for
7B, didn't for 32B), and only build the second-model gate if prompting
alone can't hold the rule. Given 32B's result, this gate may now be worth
revisiting specifically for larger models, since prompting alone did not
fix them.

## Open-weight model candidates for a follow-up round

**Qwen3-32B: tested, see results table above** — `hermes` parser
compatibility turned out fine once a working vLLM/transformers pairing was
found; the real cost was getting there (five dependency-hell iterations)
and discovering the thinking-mode content leak, not the tool-parser
question the pre-test research flagged as the open risk.

Still not yet tried, ranked by the same background research pass for
tool-calling reliability specifically (not general leaderboard score):

1. **Qwen3-30B-A3B (MoE)** — same generation as the now-tested Qwen3-32B,
   but far fewer active params per token (~3B), worth trying specifically
   for latency given dense Qwen3-32B was already the fastest model tested.
2. **Mistral Small 3.1/3.2-24B-Instruct** — reported on par with
   GPT-4o-mini for tool calling, single-GPU-friendly at AWQ int4. Flag: AWQ
   builds have had tokenizer-config gaps reported on vLLM's own GitHub.
3. **Hermes-3-Llama-3.1-70B** (NousResearch) — literally the model family
   vLLM's `hermes` tool-call parser was named after; purpose-tuned for
   agentic tool use. Larger footprint (~140GB bf16, or ~35-40GB at AWQ
   int4) than anything tried so far.

**Avoid**: `gpt-oss-120b` — confirmed via multiple independent GitHub
issues (vLLM, Ollama, LM Studio, exo) to have a structural tool-call
parsing problem, not a Groq-hosting-specific quirk. **Deprioritize**:
Llama 4 Scout/Maverick — a real, publicly-discussed gap between Meta's
tool-calling claims and observed community behavior.

## Speech-to-speech — not yet tried, but infra already exists

`server.js` once had a `VOICE_ENGINE=s2s` path (OpenAI Realtime) — **it was
fully removed on 2026-08-28** ("no flow/billing support, and the OpenAI key
was pulled... not worth maintaining a dead code path" per the comment left
in its place), and no trace of the removed code survives in git history
(the repo's earliest commit already postdates it). `costTracker.js` still
has an `openaiRealtimeMini` rate table entry left over from when it
existed. Re-adding this is a from-scratch build, not a flag flip: a new
Twilio Media Stream <-> OpenAI Realtime WebSocket bridge, audio format
conversion (Twilio's μ-law 8kHz vs. Realtime's PCM16 24kHz), and Realtime's
own function-calling protocol (different shape from Chat Completions'
`tool_calls`) would all need building and testing fresh, including
checking whether Realtime's tool calling is reliable enough for
`record_field`/`transition_flow` given how much this comparison already
found tool-calling reliability varies by provider. Scoped as a real
follow-up project, not attempted this round.
