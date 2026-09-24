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

## Customer-discovery verticals (freight, homeservices, dental, insurance, towing, septic, homecare, bailbonds)
Separate products on the same shared tables (`product` = `calldesk:<vertical>`), each selected with `PRODUCT=<vertical>`.
They produce short research-ask drafts (not sales pitches) into the same review queue; sending is still a manual click.
- `freight`: FMCSA open data (Socrata `6eyk-hxee` active broker authority joined to census `az4n-8mr2` for the published email). Tunables: `OUTREACH_FREIGHT_MAX_PER_RUN` (default 30, max 60), `OUTREACH_FREIGHT_PAGE_SIZE` (default 150), optional free `SOCRATA_APP_TOKEN`.
- `homeservices` / `dental` / `insurance`: LLM web search + homepage verification. `OUTREACH_VERTICAL_QUERIES_PER_DAY` (default 2, max 6).
- `bailbonds`: same LLM web search + homepage verification as above (rejects directories/aggregators; drafts carry a no-legal-advice rule).
- `towing` / `septic` / `homecare`: public REGISTRIES with no email. Ingest, then enrich resolves the website and a published email:
  - towing: Washington DOL company registrations (Socrata `data.wa.gov/ucdg-xgbj`, type "Registered Tow Truck Operator", active). Texas TDLR was rejected: its tow licences are per-individual driver licences with no phone/address.
  - septic: Florida DOH septic contractor listing (static HTML, parsed once per run, one lead per business authorization) and Austin liquid waste haulers (Socrata `data.austintexas.gov/pbam-er2r`).
  - homecare: Illinois IDPH home health agency directory (`illinois-edp.data.socrata.com/p7mg-cnpx`, medical names scored down) and NY DOH licensed home care services agencies (`health.data.ny.gov/6nen-x7rm`, no phone).
  - Registry -> website: the LLM proposes a site by name + city/state; it is kept only if its own pages show the business name AND its registry phone or city+state. Nothing verified means `contact_status='none'` and no draft; the registry phone stays in `signals.registry.phone` for a human call.
  - Tunables: `OUTREACH_REGISTRY_MAX_PER_RUN` (default 12, max 30 new registry leads per run), `OUTREACH_WEBSEARCH_MAX_PER_RUN` (default 12, max 30 LLM website lookups per run; the rest wait for the next run).
- State dir `~/.calldesk-<vertical>-outreach/` (needs its own `env`, copy of the calldesk one). Templates: `com.calldesk.outreach-<vertical>.plist.template` (not installed by anything).
- Stagger (local): freight/homeservices/dental/insurance at 10:07..11:37 as in their templates; towing 12:07, septic 12:37, homecare 13:07, bailbonds 13:37.
- Dry run: `PRODUCT=freight DRY_RUN=1 ./node_modules/.bin/tsx run.ts`
- Follow-ups default to 1 for these products (`OUTREACH_MAX_FOLLOWUPS` overrides). The agency research stage is skipped for them.
