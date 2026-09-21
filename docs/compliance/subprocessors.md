# Subprocessors — DRAFT (internal, requires legal review before external publication)

This is an internal working list of third parties that process CallDeskTech
customer or caller data, compiled 2026-09-21 from actual code/config
references, not from memory. It mirrors — and must stay consistent with —
the public list already published at `src/app/privacy/page.tsx` ("Who
handles data on our behalf"). If this list and the privacy page ever
diverge, the privacy page is the customer-facing source of truth; this file
exists for internal audit prep (e.g. a future SOC2 subprocessor register)
and should be updated whenever a new provider is wired in.

**This is not a certification artifact.** It does not assert that any
subprocessor has a signed DPA, BAA, or SOC2 report on file with us — that
verification is unstarted (see gap analysis, item 6).

| Subprocessor | Function | Evidence in repo |
|---|---|---|
| Twilio | Telephony (inbound/outbound PSTN calls, recordings) | `src/app/api/calls/[id]/recording/route.ts`, `supabase/migrations/022_recording_retention.sql`, Twilio MCP account SID present in tooling |
| Deepgram | Speech-to-text | referenced in `src/app/privacy/page.tsx`; STT integration lives in the call-loop-poc/realtime-tts services (out of this repo's scope) |
| Anthropic | LLM that drafts agent replies (Claude) | referenced throughout `src/lib/agentTemplates.ts`, `ANTHROPIC_API_KEY` used by the app's own generation routes |
| Modal, ElevenLabs, Cartesia, MiniMax | Text-to-speech (Modal default; ElevenLabs/Cartesia/MiniMax selectable per agent) | `src/app/privacy/page.tsx`; TTS routing lives in realtime-tts (out of this repo) |
| Supabase | Primary database (Postgres), auth-adjacent storage | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` in `.env.example`, `fly.toml` |
| Fly.io | Application hosting (calldesk-tech, call-loop-poc, realtime-tts-gateway) | `fly.toml`, `../call-loop-poc/fly.toml` |
| Stripe | Payments/billing | `src/app/privacy/page.tsx`; billing routes in `src/app/api` |
| Google (OAuth) | Customer sign-in | NextAuth Google provider, `src/lib/auth.ts` |
| Resend | Transactional/alert email | `RESEND_API_KEY`, `ALERT_FROM_EMAIL` in `.env.example`, `src/lib/email.ts` |
| PostHog | Product/website analytics | `NEXT_PUBLIC_POSTHOG_KEY` in `fly.toml` |
| Cal.com | Optional customer-connected scheduling tool | `CAL_API_KEY` in `.env.example` |

## Open items before this list can support a real compliance claim

1. No confirmed DPA/BAA on file with any of the above — needs procurement/legal follow-up per vendor.
2. Voice/TTS/STT subprocessors (Deepgram, ElevenLabs, Cartesia, MiniMax, Modal) live in sibling services (`realtime-tts`, `call-loop-poc`) not audited in this pass — their own data-handling needs the same review.
3. No process yet for notifying customers before adding a new subprocessor (common SOC2/GDPR expectation).
