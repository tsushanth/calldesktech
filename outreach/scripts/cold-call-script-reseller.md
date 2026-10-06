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
- Pricing is public on calldesk.tech/pricing: phone agents from 2 cents a minute. Lite is 2 cents, Standard is 5 cents and
  Pro is 9 cents per minute. Each price covers the whole engine (the language model and the voice). They bring their own phone
  carrier or number, or buy a number from us. No per-booking or per-transfer fees.
- It supports 55 languages on live calls. Lite's voice is English only; other languages need Standard or Pro.
- We are looking for a small number of agencies to be design partners and try it with their clients.
- Partners get a 20% revenue share on usage from customers they refer.
- Partners get a free trial and direct access to the founders.
- Terms beyond the 20% share (how long it lasts, when it is paid, any minimums) are being finalized with the first
  partners. If asked, say exactly that. The only prices you may state are the ones on this sheet. Never state a duration, a payout date or a minimum.

## Lead with the price, and offer both routes

Every pitch starts with the price and gives both ways to work together. Then let them choose:

- **Route 1, our platform:** Calldesk phone agents from 2 cents a minute. This is for agencies that sell or resell voice agents and
  would use our platform with their clients (with the 20% revenue share on customers they refer).
- **Route 2, our speech API:** readaloudai.org text-to-speech and speech-to-text, to plug into a voice platform they already own.
  This is for companies that built their own platform, and for vendors that look like us. Do not push our platform at a vendor
  that already has its own: for them lead with Route 2.
- Say both in the first thirty seconds, then follow whichever one they pick. Read the "What they do" column on your list sheet
  first so you can say which you expect to fit.

There is no language-model product or "optimization" to sell on its own: the language model is simply included in the
per-minute platform price. Do not claim more than that.

### The one-line pitch (the price comes first)

> "Calldesk phone agents start at 2 cents a minute, with the language model and the voice included. If you already run your own
> platform, our speech API is four tenths of a cent per thousand characters of text-to-speech and eleven cents an hour of
> speech-to-text. Which of those would fit you better?"

(The exact figures: $0.004 per 1,000 characters for text-to-speech, $0.11 per hour for speech-to-text.)

- Route 2 works because they already pay for speech on every call. We are not asking them to change what their agent does,
  only to point the speech part at us.
- Do not state a total saving or a percent. How much it saves depends on how much their agent talks and which voices they
  use, and we do not have their numbers. If they ask "how much would I save", say the founders can run their numbers on the
  call. The per-unit prices below are what you may quote.
- In Route 2 the language model and the telephony are not ours; do not claim to lower them. (In Route 1 the language model is
  included in the per-minute price, nothing more.)

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

Read the "What they do" column for that company on your list sheet before you dial (what they build, who they serve). If it
is not clear, ask:

> "Do you build the voice agents on your own stack, or on a platform like Retell or Vapi?"

Do not name or judge any platform in your own words, only repeat theirs. Listen to what they build, for whom and
what is hard for them. Build on THAT in the next step. If they sell AI receptionists directly (they look like a
competitor), do not pretend otherwise: the offer below is still honest, and they can say no.

## 4. Case 1: receptive / curious

> "Calldesk phone agents start at 2 cents a minute, with the language model and voice included, and our speech API is four
> tenths of a cent per thousand characters of text-to-speech and eleven cents an hour of speech-to-text. We are picking a
> small number of agencies as design partners: a free trial, direct access to the founders, and a 20% revenue share on usage
> from customers they refer to the platform. Which would fit you better, our platform or the speech API in your own?"

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

## When an AI answers, or an AI voicemail picks up: leave a message

More and more of these companies sell AI phone agents, and some answer their own phone with one. If you reach an AI (it says it is
an AI or virtual assistant, or an automated system asks you to leave a message after the tone), do not hang up and do not try to
pitch it. **Leave this short message** (about 20 seconds), then end the call:

> "Hi, this is [your name] with Calldesk. We make phone agents from 2 cents a minute, with the language model and voice included,
> and a speech API from four tenths of a cent per thousand characters of text-to-speech and eleven cents an hour of
> speech-to-text, for plugging into a voice platform you already run. We are picking a few design partners, with a 20% revenue
> share on customers they refer. Please pass this to the owner, or whoever looks after partnerships. You can find us at
> calldesk dot tech, and the speech API at readaloud A I dot org. Thank you."

- If a live AI assistant answers and asks how it can help, say: "Please pass a message to the owner or whoever looks after
  partnerships," then give the message above in one go. If it offers to take a message or send a link, accept.
- Log the outcome as **Voicemail** (if it was an AI voicemail) or **Gatekeeper** (if a live AI assistant took the message), and
  write **"AI, left message"** in the notes. Answer the owner/decision-maker question No.
- Do not argue with the AI, do not try to get it to confirm anything, and do not say the company is a competitor.

## Voicemail with a person's greeting

A voicemail with a real person's recorded greeting: do not leave a message. Log "voicemail" and retry that number once, at a
different time of day.

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
