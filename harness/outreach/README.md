# Outreach discovery harness (Mac mini)

Runs one bounded discovery pass per day: finds agencies (Retell directory + web search), dedupes,
finds contacts on their own sites, and writes email drafts to the review queue. **It never sends email.**
Sending stays a manual click in `/admin/outreach/queue`.

Uses the `claude` CLI on the mini (OAuth, no API key) via `OUTREACH_LLM=cli`.

## Control
- Stop everything now:  `touch ~/.calldesk-outreach/STOP`   (resume: `rm` it)
- Run once now:         `launchctl kickstart gui/$(id -u)/com.calldesk.outreach-discovery`
- Dry run (no writes):  `cd ~/calldesk-outreach-harness/repo/harness/outreach && set -a && . ~/.calldesk-outreach/env && set +a && DRY_RUN=1 ./node_modules/.bin/tsx run.ts`
- Logs / history:       `~/.calldesk-outreach/logs/`, `~/.calldesk-outreach/runs.jsonl`
- Uninstall:            `launchctl bootout gui/$(id -u)/com.calldesk.outreach-discovery && rm ~/Library/LaunchAgents/com.calldesk.outreach-discovery.plist`

## Limits (enforced in code, `run.ts` / `pipeline.ts`)
one run per day - enrichment <= 30 and drafts <= 10 per run - stops drafting at 25 unreviewed drafts -
40-minute deadline - skips under 400 MB free disk - lock prevents overlapping runs.

## Env (`~/.calldesk-outreach/env`, chmod 600)
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OUTREACH_LLM=cli`, optional `OUTREACH_ENRICH_LIMIT`,
`OUTREACH_DRAFT_LIMIT`, `OUTREACH_SEARCH_QUERIES_PER_DAY` (max 6), `RESEND_API_KEY` + `OUTREACH_ALERT_EMAIL` for failure emails.

## Customer-discovery verticals (freight, homeservices, dental, insurance)
Separate products on the same shared tables (`product` = `calldesk:<vertical>`), each selected with `PRODUCT=<vertical>`.
They produce short research-ask drafts (not sales pitches) into the same review queue; sending is still a manual click.
- `freight`: FMCSA open data (Socrata `6eyk-hxee` active broker authority joined to census `az4n-8mr2` for the published email). Tunables: `OUTREACH_FREIGHT_MAX_PER_RUN` (default 30, max 60), `OUTREACH_FREIGHT_PAGE_SIZE` (default 150), optional free `SOCRATA_APP_TOKEN`.
- `homeservices` / `dental` / `insurance`: LLM web search + homepage verification. `OUTREACH_VERTICAL_QUERIES_PER_DAY` (default 2, max 6).
- State dir `~/.calldesk-<vertical>-outreach/` (needs its own `env`, copy of the calldesk one). Templates: `com.calldesk.outreach-<vertical>.plist.template` (not installed by anything).
- Dry run: `PRODUCT=freight DRY_RUN=1 ./node_modules/.bin/tsx run.ts`
- Follow-ups default to 1 for these products (`OUTREACH_MAX_FOLLOWUPS` overrides). The agency research stage is skipped for them.
