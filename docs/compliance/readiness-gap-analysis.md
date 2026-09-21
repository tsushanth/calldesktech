# HIPAA / SOC2 / GDPR readiness — gap analysis

**DRAFT — internal gap analysis only. Requires legal/compliance review
before any external claim of certification, compliance, or audit-readiness
is made to a customer, partner, or auditor. Nothing in this document is or
implies a certification.**

Compiled 2026-09-21 against the state of this repo as of commit `c2f259a`
(RBAC/SSO/batch calls shipped same day). Citations are real file/line
references, not assumptions.

## 1. Encryption in transit
**Status: OK.** `fly.toml` sets `force_https = true` for calldesk-tech; the
sibling `call-loop-poc/fly.toml` (read-only reference, not owned by this
task) also sets `force_https = true` with `min_machines_running = 1` to
avoid dropping a live call. `next.config.ts` has no HTTP fallback or
insecure rewrite. No plaintext HTTP path found.

## 2. Encryption at rest
**Status: provider default, not independently verified.** Data lives in
Supabase Postgres (`NEXT_PUBLIC_SUPABASE_URL` in `fly.toml`/`.env.example`).
Supabase encrypts data at rest by default at the infrastructure level, but
that has not been independently confirmed against our specific project
tier/region, and we hold no documentation from Supabase asserting it for
our account. **Effort to close: low** — request/confirm via Supabase
support or their compliance docs; no code change needed.

## 3. Access controls / audit logging
**Before this pass:** RBAC (migration `038_team_members.sql`,
`src/lib/authz.ts`) added real enforcement today — three roles
(owner/admin/member), checked per-route via `requireTenantRole`/
`authorizeResource`. But nothing recorded *who did what* — only who was
*allowed* to.

**Built in this pass:** `calldesk_audit_log` table (migration
`039_audit_log.sql`), append-only, service-role-only writes, no
user-facing edit/delete path. Wired into six routes via
`src/lib/auditLog.ts`: team invite (`src/app/api/tenants/[id]/team/route.ts`
POST), role change and member removal
(`src/app/api/tenants/[id]/team/[memberId]/route.ts` PATCH/DELETE), API key
creation (`src/app/api/tenants/[id]/api-keys/route.ts` POST), API key
revocation (`src/app/api/tenants/[id]/api-keys/[keyId]/route.ts` DELETE),
and agent deletion (`src/app/api/agents/[id]/route.ts` DELETE). Deployed to
production (`fly deploy`, `calldesk-tech.fly.dev`) and verified with a real
HTTP call — see PART 2 evidence in the engineering handoff.

**Still missing:** audit coverage is scoped to RBAC-adjacent actions only —
it does not cover call/transcript access, knowledge-base edits, or billing
changes. No read UI for the log yet (query via SQL only). **Effort: medium**
to extend coverage + build a viewer.

**Separately noted (not fixed in this pass, flagged for follow-up):**
`DELETE /api/tenants/[id]/api-keys/[keyId]` uses `authorizeTenant` (any
active member) rather than `requireTenantRole(['owner','admin'])` like the
POST (create) route does — any active member, not just owner/admin, can
currently revoke a tenant's API keys. Worth a follow-up RBAC fix; out of
scope for this compliance pass since it's a role-enforcement bug, not a
missing-fix from PART 2's list.

## 4. Data retention & deletion
Call recordings: `supabase/migrations/022_recording_retention.sql` adds
`recording_sid` to `calldesk_call_logs` specifically so a real Twilio
recording can be deleted (`DELETE /Recordings/{Sid}.json`) once a retention
window passes — the comment references `enforceRecordingRetention` in
call-loop-poc (a sibling service, not audited here). Whether that job
actually runs on a schedule and what the configured window is could not be
confirmed from this repo alone.

Call records/transcripts: no dedicated deletion endpoint exists for a
single call's transcript/recording (`grep` across `src/app/api` found no
`DELETE` route under `.../calls/...`). `src/app/privacy/page.tsx` states
"Customers can delete calls and agents from their dashboard" — agent
deletion is real (`DELETE /api/agents/[id]`, cascades per migration 005),
but no analogous per-call delete route was found, so that privacy-page claim
is broader than what the API currently supports for calls specifically.
**This is the top-priority gap**: either build the missing per-call delete
endpoint, or correct the privacy page's claim to match reality. Scoping a
real delete safely (without breaking QA/analytics history that reads
`calldesk_call_logs`) needs a product decision on soft-delete vs hard-delete
semantics — not made in this pass to avoid an unreviewed behavior change.
**Effort: medium.**

## 5. PII/PHI handling
`src/lib/agentTemplates.ts`'s medical-receptionist templates (lines ~2268,
~2589) instruct the agent, via prompt, not to read back full medical
details and to acknowledge-and-move-on if a caller volunteers sensitive
information. This is prompt-level guidance only — there is no code-level
redaction, no BAA process with subprocessors that would touch PHI
(Anthropic, Deepgram, Twilio, TTS vendors), and no technical control
preventing PHI from reaching transcripts, logs, or the LLM. A medical
customer using this template today is *not* HIPAA-covered by any technical
safeguard beyond a prompt instruction. **Effort: high** — needs BAAs with
every subprocessor in the transcript path plus real technical controls
(redaction, scoped storage) before any medical/HIPAA claim is possible.

## 6. Subprocessor list
See `docs/compliance/subprocessors.md` — compiled from real code/config
references (`.env.example`, `fly.toml`, `src/app/privacy/page.tsx`, source
files). Matches the already-published privacy page; no contradiction
introduced. Gaps: no confirmed DPAs/BAAs on file, and the TTS/STT vendor
chain lives outside this repo (realtime-tts, call-loop-poc) and wasn't
independently audited.

## 7. Incident response
**Status: none found.** No incident-response doc, runbook, or process
exists anywhere in this repo (`grep` for "incident" across the tree found
nothing). No documented escalation path, no defined severity levels, no
customer-notification SLA. **Effort: low-medium** to draft a first version;
this pass did not draft one since it's a standalone policy document better
owned by whoever will actually be on call for it, not written speculatively
here.

## 8. Session / access security
`src/lib/auth.ts` uses NextAuth with `session: { strategy: 'jwt' }` and no
explicit `maxAge` — that means NextAuth's default (30 days) applies; no
enforced shorter session timeout. Sign-in is Google OAuth (`SSO` work
shipped today per `49db906`, generic OIDC now supported alongside Google)
but no MFA is enforced by CallDeskTech itself — MFA, if any, is whatever the
user's own Google/IdP account requires, outside our control. **Effort:
low** to tighten `maxAge`; **effort: high** to add first-party MFA (not
recommended before evaluating whether IdP-delegated MFA already suffices
for target compliance frameworks).

---

## Prioritized punch list before pursuing real certification

1. **Legal review of this document and the subprocessor list** — nothing here has been reviewed by counsel; do not share externally as-is.
2. **Per-call data deletion** — build the missing endpoint or correct the privacy-page claim (item 4). Reversible, low-risk, should be next.
3. **Confirm Supabase encryption-at-rest** for our specific project (item 2) — a support ticket, not engineering work.
4. **BAAs/DPAs with subprocessors** in the transcript/PHI path, starting with Anthropic and Twilio (item 5, 6) — procurement/legal-led.
5. **Draft an incident response runbook** (item 7) — should be owned by whoever holds on-call responsibility.
6. **Fix the API-key-revoke RBAC gap** noted in item 3 (any active member can currently revoke keys, not just owner/admin).
7. **Extend audit log coverage** to call/transcript access and knowledge-base edits (item 3).
8. **Tighten session `maxAge`** (item 8) — small config change.
9. Only after the above: engage a paid SOC2 Type I auditor. A realistic Type I timeline, once items 2–4 and 6–8 are closed, is roughly 2–3 months (control implementation + evidence collection + audit fieldwork); Type II requires a 3–6 month observation period after that. This is a rough industry-typical estimate, not a quote from any specific auditor.
