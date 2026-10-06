# CallDeskTech cold-call script: voice-AI agencies and resellers

Goal of every call: get the owner or head of the agency to agree to a 15-minute call with the founders about
becoming a Calldesk design partner, or, for the speech-API angle below, about trying the readaloudai.org API. That is
the only ask. We are not selling them a phone service.

Who you are calling: small agencies, studios and software shops that build or sell AI voice agents and AI
receptionists to other businesses, plus a few AI-receptionist vendors. Most are small teams, so whoever picks up
is often the owner or someone close to the owner. Some are based outside the US or Canada and still serve US
and Canadian clients; where the business is based does not matter, only that the number is a working +1 number.

This is the reseller variant of `cold-call-script.md`. The decision-maker rule, the disclosure, the hard rules and
the outcome logging are the same. The offer and the ask are different.

## What the partner offer is (say only this)

- Calldesk (calldesk.tech) is an AI voice-agent platform: inbound and outbound phone agents, a knowledge base and
  call analytics.
- It supports 55 languages on live calls.
- We are looking for a small number of agencies to be design partners and try it with their clients.
- Partners get a 20% revenue share on usage from customers they refer.
- Partners get a free trial and direct access to the founders.
- Terms beyond the 20% share (how long it lasts, when it is paid, any minimums) are being finalized with the first
  partners. If asked, say exactly that. Never state a price, a duration, a payout date or a minimum.

## Two angles: pick by what they built

Every lead is an agency or a company that builds voice products. Which pitch you use depends on what they do:

- **They sell or resell finished voice agents or phone platforms to clients** -> pitch the Calldesk platform (the offer above).
- **They built their own platform or product and run their own voice stack** -> pitch the ReadAloud speech API as a component
  to plug into what they already have. They do not need our phone platform; they may need cheaper speech.
- Not sure -> ask the discovery question in section 3 and let their answer decide. One angle per call by default; offer
  the other only if they ask about it.

### The pitch for this angle, in one line

> "Every minute of a voice-agent call pays for speech to text, speech to text back out, the language model and the phone
> line. We sell the two speech parts, and our list prices for them are lower, so your cost per call minute goes down."

- It works because they already pay for speech on every call. We are not asking them to change what the agent does, only
  to point the speech part at us.
- Do not state a total saving or a percent. How much it saves depends on how much their agent talks and which voices they
  use, and we do not have their numbers. If they ask "how much would I save", say the founders can run their numbers on the
  call. The per-unit prices below are what you may quote.
- The language model and the telephony are not ours in this angle; do not claim to lower them.

### The speech-API offer (say only this)

- readaloudai.org is a realtime speech-to-text and text-to-speech API for developers building voice products.
- Text-to-speech from $0.004 per 1,000 characters (Piper voices) and $0.01 per 1,000 characters (Kokoro voices).
- Speech-to-text at $0.11 per hour of audio, billed by the second. Transcription uses Whisper large-v3-turbo and takes
  clips up to 25 MB per call.
- Pay as you go, no monthly minimum. New accounts get free credits to try it (worth $0.10, about 10,000 characters of
  speech, so enough to hear the voices, not to run a pilot).
- It also works as an MCP server at `https://readaloudai.org/mcp`: one URL, so an AI assistant or agent that supports MCP can call text-to-speech and transcription directly. For a
  product or platform integration they would use the REST and WebSocket API instead.
- We are looking for a small number of early integration partners, with direct access to the founders for
  integration support.
- Terms beyond pricing (volume discounts, SLAs) are being finalized with the first partners. There is no resale or
  revenue-share term for the speech API yet. If they ask about one, say the founders will follow up; never invent a number.
- If they ask about scale: each Piper server handles up to 12 simultaneous streams, and the founders can discuss
  capacity for their volume. Do not promise more than that.

### The price comparison (the only one you may make)

You may say our list price is lower than ElevenLabs and Deepgram. Public list prices, checked on 2026-10-05 on each
company's own pricing page (re-check before quoting if this sheet is more than a few weeks old):

| | Ours | ElevenLabs | Deepgram |
|---|---|---|---|
| Text-to-speech per 1,000 characters | $0.004 Piper, $0.01 Kokoro | $0.04 Flash, $0.08 Multilingual v2 | $0.030 Aura-2 |
| Speech-to-text, batch, per hour | $0.11 | $0.22 (Scribe) | about $0.26 ($0.0043 per minute, Nova-3 pre-recorded) |

Rules for using it:
- Say it as a list-price comparison and offer to send it in writing: "On list price we are lower than ElevenLabs and
  Deepgram. I can email you the numbers so you can check them."
- Compare only to ElevenLabs and Deepgram, only these figures, and only batch speech-to-text against batch (not their
  realtime or streaming rates).
- Never say we are better, faster or higher quality, and never say the voices sound the same. Piper and Kokoro are not
  ElevenLabs voices. If they ask about quality, say you do not have a verified comparison to quote and the founders can
  share sample audio.
- If they name another provider (Groq, DeepInfra, Cartesia and so on), do not argue and do not claim to beat it. Say you
  do not have their numbers and the founders can compare in the call.

The ask for this angle is the same: 15 minutes with the founders, or they try the free credits and tell us what breaks.

## 1. Open (10-15 sec)

> "Hi, this is [your name] with Calldesk. Am I speaking with the owner, or whoever looks after partnerships and
> the tools you build on?"

- **Owner or decision maker:** go to section 2, then section 3.
- **Someone else, not the owner:** "No problem. Who would be the right person, and is there an email I can send a
  short note to?" Log "gatekeeper" with the name, the best time and the email. Do not pitch. Thank them and hang up.
- **"What is this about?"** -> "We are looking for a few agencies that build voice agents to try our platform with
  their clients. I will email the details." Do not say "free" or "revenue share" to a gatekeeper.
- If they say they ARE the owner or the one in charge, treat them as the decision maker and continue.

If they are busy: "No worries, when is a better time to catch you?" If still no, thank them and hang up.

## 2. Disclosure (say this before anything else, every call)

> "Quick heads up, this call may be recorded for quality."

Not optional. Say it before the real conversation starts.

## 3. Discover (one question, then listen)

Use what the batch screen shows about the company if there is a note (what they build, who they serve). If there is
nothing, ask:

> "Do you build the voice agents on your own stack, or on a platform like Retell or Vapi?"

Do not name or judge any platform in your own words, only repeat theirs. Listen to what they build, for whom and
what is hard for them. Build on THAT in the next step. If they sell AI receptionists directly (they look like a
competitor), do not pretend otherwise: the offer below is still honest, and they can say no.

## 4. Case 1: receptive / curious

> "We are a platform for inbound and outbound phone agents, 55 languages on live calls. We are picking a small
> number of agencies as design partners to try it with their own clients. Partners get a free trial, direct access to
> the founders, and a 20% revenue share on usage from customers they refer."

- If they ask about terms past the 20%: "Duration, payout timing and minimums are being finalized with the first
  partners, which is part of why we want the call." Do not guess.
- If they ask something you do not know: "I will have the founders follow up by email." Never guess.
- If they say "send me an email" or "let me think": that is not a no. Say you will send details, ask for the best
  email, thank them. Do not push for a decision on the call.

## 5. Case 2: skeptical / busy

- **"Is this a sales call?"** -> "Not really. We are looking for agencies to try the platform with their clients,
  and there is no cost to try it." If they still say no, thank them and hang up.
- **"We already use Retell / Vapi / our own thing."** -> "That makes sense. This is not a replacement for anything
  you run today, just something to try on the side with one client." Do not compare, do not claim we are better.
- **"What is the catch?"** -> "None that I know of. The terms past the 20% share are still being set with the first
  partners, so the founders would walk you through where they stand."
- **Any clear "not interested" or "take me off your list"** -> "Understood, thanks for your time" and hang up
  immediately. Never push past a real no. Log do-not-call if they asked to be removed.

## 6. Close (the only thing that counts as a win)

> "Would 15 minutes with the founders this week or next work? I can send an invite to the best email."

A yes, or a specific time, counts. Log the email and the time. Anything vaguer ("maybe later", "send me something")
is not a win: note it and move on.

## Hard rules, every call, no exceptions

- Never invent a statistic, a customer, a price, a payout date or a result.
- Never say we are better or faster than any competitor, and never disparage Retell, Vapi or any platform. For the platform
  angle, make no price comparison. For the speech-API angle, the only comparison allowed is the list-price table above.
- Never promise anything beyond the offer facts above. If you do not know, say the founders will follow up by email.
- Never say the agency is a Retell partner or mention where we found them.
- A clear no gets a polite close, never a rebuttal.

## Voicemail

Do not leave a message. Log "voicemail" and retry that number once, at a different time of day.

## If the line goes quiet

If the person stops answering for more than 10 seconds, ask once "Are you still there?", wait, and end the call.
Log what happened in the notes ("went silent").

## Language

If the person answers in another language and cannot continue in English, thank them politely and end the call.
Log "wrong language" in the notes with the language you heard. Do not try to continue.

## After every call, log one outcome

no answer / voicemail / gatekeeper / callback requested / forward-number requested / not interested / wrong number /
do-not-call

For this script, "callback requested" is the win (a booked 15-minute call). "Forward-number requested" does not
apply.

**Whenever a person spoke to you** (gatekeeper, callback requested, forward-number requested, not interested,
do-not-call) the form also asks: **Did you reach the owner / decision maker?** Answer Yes only if the person said
they own the company or run partnerships. A receptionist or junior is No. If you are not sure, answer No. It is
never counted against you.

A call that is blocked on the line is outside legal calling hours for that business, or the number is not in your
batch for the day. Log it and move to the next number.
