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

## Customer-discovery verticals (16)
`freight`, `homeservices`, `dental`, `insurance`, `towing`, `septic`, `homecare`, `bailbonds`, and batch 3:
`childcare`, `accounting`, `realestate`, `lodging`, `funeral`, `physio`, `taxi`, `vets`.
Separate products on the same shared tables (`product` = `calldesk:<vertical>`), each selected with `PRODUCT=<vertical>`.
They produce short research-ask drafts (not sales pitches) into the same review queue; sending is still a manual click.
- `freight`: FMCSA open data (Socrata `6eyk-hxee` active broker authority joined to census `az4n-8mr2` for the published email). Tunables: `OUTREACH_FREIGHT_MAX_PER_RUN` (default 30, max 60), `OUTREACH_FREIGHT_PAGE_SIZE` (default 150), optional free `SOCRATA_APP_TOKEN`.
- `homeservices` / `dental` / `insurance`: LLM web search + homepage verification. `OUTREACH_VERTICAL_QUERIES_PER_DAY` (default 2, max 6).
- `bailbonds`: same LLM web search + homepage verification as above (rejects directories/aggregators; drafts carry a no-legal-advice rule).
- `childcare`: US state child care LICENSING data, three sources, all with a contact email on most rows (`discovery/childcareUs.ts`):
  - `tx-childcare`: Texas HHSC (`data.texas.gov/bc5r-88dy`). `operation_status='Y'`, and only `Licensed Center` + `Licensed Child-Care Home` — `Listed Family Home`, `Registered Child-Care Home`, `General Residential Operation` and `Child Placing Agency` are all out of scope.
  - `wa-childcare`: Washington DCYF (`data.wa.gov/was8-3ni8`). `latestoperatingstatus='Active'`; all three programme types kept. The phone column is nearly empty (2,915 of 3,160 rows), so most WA leads have an email and no phone.
  - `pa-childcare`: Pennsylvania DHS (`data.pa.gov/ajn5-kaxt`). Child Care Center / Family Child Care Home / Group Child Care Home; `Other` is skipped (no licence number, no describable type).
  - One state per run, rotating by hourly slot weighted by pool size (TX and PA two slots in five each, WA one). Also bulk-importable: `PRODUCT=childcare SOURCE=tx-childcare DRY_RUN=1 ./node_modules/.bin/tsx bulk-import.ts`.
  - FREE MAIL, deliberately different here: ~41% of usable Texas rows and ~64% of Pennsylvania's publish a gmail/yahoo/aol address, because a small or home-based centre really does run on one, and those are the best-fitting leads in this vertical. So unlike `ca-cdph` (which discards a free-mail address), childcare KEEPS it as the contact. `registryLeadRow` still leaves `domain` null for a free-mail address, so nothing downstream treats it as a verified business domain. Scored -8, not excluded.
  - National chains and large multi-site operators (KinderCare, Bright Horizons, Goddard, Right At School, YMCA, Boys & Girls Club, …) are skipped outright — 32% of Washington's active rows.
- `accounting` / `realestate` / `lodging` / `funeral` / `physio` / `taxi` / `vets`: no DOMESTIC discovery source yet, so a `run.ts` pass for one of these still finds nothing (add it to `stageRegistry`/`verticalSearch` the way `childcare` was). They do now have INTERNATIONAL bulk sources, all on hold: `physio`/`taxi`/`accounting`/`vets`/`realestate` via `no-brreg`, `funeral` via `fr-funeral`, `lodging` via `qc-lodging` — see the international section below.
- `towing` / `septic` / `homecare`: public REGISTRIES with no email. Ingest, then enrich resolves the website and a published email:
  - towing: Washington DOL company registrations (Socrata `data.wa.gov/ucdg-xgbj`, type "Registered Tow Truck Operator", active). Texas TDLR was rejected: its tow licences are per-individual driver licences with no phone/address.
  - septic: Florida DOH septic contractor listing (static HTML, parsed once per run, one lead per business authorization) and Austin liquid waste haulers (Socrata `data.austintexas.gov/pbam-er2r`).
  - homecare: Illinois IDPH home health agency directory (`illinois-edp.data.socrata.com/p7mg-cnpx`, medical names scored down) and NY DOH licensed home care services agencies (`health.data.ny.gov/6nen-x7rm`, no phone).
  - Registry -> website: the LLM proposes a site by name + city/state; it is kept only if its own pages show the business name AND its registry phone or city+state. Nothing verified means `contact_status='none'` and no draft; the registry phone stays in `signals.registry.phone` for a human call.
  - Tunables: `OUTREACH_REGISTRY_MAX_PER_RUN` (default 12, max 30 new registry leads per run), `OUTREACH_WEBSEARCH_MAX_PER_RUN` (default 12, max 30 LLM website lookups per run; the rest wait for the next run).
- State dir `~/.calldesk-<vertical>-outreach/` (needs its own `env`, copy of the calldesk one). Templates: `com.calldesk.outreach-<vertical>.plist.template` (not installed by anything).
- Stagger (local): freight/homeservices/dental/insurance at 10:07..11:37 as in their templates; towing 12:07, septic 12:37, homecare 13:07, bailbonds 13:37, childcare 14:07, accounting 14:37, realestate 15:07, lodging 15:37, funeral 16:07, physio 16:37, taxi 17:07, vets 17:37.
- Staging a vertical on the mini: `./setup-vertical.sh <vertical>` creates `~/.calldesk-<vertical>-outreach/env` (a copy of an existing vertical's env, never overwritten) and renders its plist into `~/Library/LaunchAgents/`. It does NOT load the agent or run a pass — it prints the `launchctl bootstrap` / `kickstart` and dry-run commands for you to run yourself.
- Dry run: `PRODUCT=freight DRY_RUN=1 ./node_modules/.bin/tsx run.ts`
- Draft language: these prompts write in English unless the lead's location maps to a target language (`discovery/../language.ts` -> `agencyDraft.ts` adds "Target language: X"), in which case the whole email is written in that language with the pilot terms unchanged in meaning, plus an English back-translation (`translationSubject`/`translationBody`) for review. Covered: ES, PT, FR (France) and fr-CA (Quebec), NO, IT, NL, PL, SV, ID, TR, VI, TH, JA, KO. Estonia and Singapore are explicitly English.
- Follow-ups default to 1 for these products (`OUTREACH_MAX_FOLLOWUPS` overrides). The agency research stage is skipped for them.

## International registry sources, and the hold on them (`bulk-import.ts`, `release-country.ts`)
Non-US public registers feed the verticals and — new — the agency/partner audience (`PRODUCT=calldesk`, the
same pitch the Retell directory serves domestically). They are **bulk-import only** — deliberately not in the

Six non-US public registers feed the same verticals. They are **bulk-import only** — deliberately not in the
per-run rotation, because every lead they produce is on hold and cannot be drafted or sent, so giving them a
daily slot would only starve the US sources that actually convert.

| source | vertical(s) | register | contact detail |
|---|---|---|---|
| `fr-rge` | homeservices | French RGE contractor register (ADEME data-fair API, Licence Ouverte, no key) | email on most rows, phone on nearly all |
| `uk-cqc` | dental, homecare | Care Quality Commission directory of registered locations (one CSV) | **no email**; phone on nearly all, website on many |
| `uk-dvsa` | freight | Goods vehicle operator licences, 8 traffic-area CSVs (OGL) | **no email, no phone** |
| `no-brreg` | dental, homeservices, freight, towing, insurance, homecare, physio, taxi, accounting, vets, realestate, **calldesk** | Norwegian Enhetsregisteret JSON API (NLOD, no key) | email on ~7-47% depending on the industry code |
| `fr-funeral` | funeral | French national list of authorised funeral operators (data.gouv.fr, **licence "notspecified"** — see below) | email on 98.9%, phone on 85.7% |
| `qc-cpe` | childcare | Québec Ministère de la Famille directory of CPEs and garderies (donneesquebec.ca, CC-BY 4.0) | email on nearly all rows, but only 2,824 distinct |
| `qc-lodging` | lodging | Tourisme Québec campings / gîtes / pourvoiries registers (donneesquebec.ca, CC-BY 4.0) | email and phone on most, website on many |
| `sg-ecda` | childcare | Singapore ECDA list of licensed child care centres (data.gov.sg datastore API) | email, phone and website on nearly all |
| `ee-agencies` | **calldesk** | Estonian Business Register open data (RIK, 230 MB zip streamed, never saved) | email on ~99% |

**`fr-funeral`: the licence is not settled.** Every other source here states a licence (NLOD, Licence Ouverte,
OGL, CC-BY 4.0, Singapore ODL). The data.gouv.fr funeral-operator dataset declares its licence as
`notspecified`, i.e. there is **no published permission to reuse it**. Importing it is safe, because every lead
lands on the hold and is inert — but **France must not be released for the `funeral` vertical until reuse terms
are confirmed with the DGCL**, and releasing France for `homeservices` (whose RGE data *is* Licence Ouverte)
does not settle this dataset. Each `fr-funeral` lead carries the unresolved licence in `signals.registry` so a
reviewer sees it on the row, not only here.

**Québec: CC-BY 4.0 requires attribution.** Every `qc-*` lead records `source <registry>, donneesquebec.ca,
licence CC-BY 4.0` in `signals.registry`, so the obligation travels with the data. Québec leads are stored with
`country = CA` (that is what `COUNTRY=CA release-country.ts` releases) and `location = "<City>, QC"` (that is
what picks **Canadian** French for the draft). They are additionally held pending a **CASL** review: Canada's
anti-spam law is consent-based, and nothing about the ordinary hold substitutes for that review.

**The RBQ contractor licences were investigated and NOT built.** `donneesquebec.ca` publishes the RBQ's
`licencesactives` register (54,237 active licences, most with an email), and it would be a good homeservices
source if the trade could be identified — but it cannot. The export gives subcategory CODES with no names, and
`Categorie` appears only on the first element of each licence's subcategory array, so a code cannot even be
attributed to the general or the specialised scheme. Worse, the codes present do not match the RBQ's published
Annexe I numbering: the live distribution is `GPC` 52,944, `SEC` 52,766, `ADM` 52,688, then `9` 44,160,
**`7` 43,429**, `8` 43,084, `11.2` 42,675 … — code `7` is on 80% of all active contractor licences, so it is
plainly not "isolation, étanchéité, couvertures et revêtements extérieurs". If `7` cannot be trusted, neither
can `15.5` (2,295) or `16` (3,981), however plausible their volumes look. Building it would have meant telling
tens of thousands of leads we know a trade we cannot show they hold. To revisit it, get the authoritative
code→name table for THIS export from the RBQ (the published "fiche descriptive" PDF documents the fields only).

**Norway moved to SN2025.** A retired industry code returns a perfectly valid, EMPTY result from the Brreg API,
so a stale code imports nothing and says nothing. `no-brreg` therefore probes every code it is about to use and
turns a zero-row code into a loud error in the run output (`62.010`, `62.020`, `70.220` and `43.220` are the
known-dead ones). Several agency codes also exceed the API's 10,000-result window even after the legal-form
slice; those are split by **registration date** (employee-count slicing is impossible — Brreg refuses any query
between one and four employees on privacy grounds).

**Estonia is a 230 MB zip that inflates to ~4.6 GB.** It is streamed and inflated in memory and never written
to disk. The walk is bounded by a decompressed-byte budget, so a default run covers an **alphabetical slice**
of the name-ordered array rather than the whole register, and says so in the run's errors. Raise
`byteBudget` to go further.

| `no-brreg` | dental, homeservices, freight, towing, insurance, homecare | Norwegian Enhetsregisteret JSON API (NLOD, no key) | email on ~7%, phone on ~40% |
| `br-cnpj` | accounting, childcare, dental, freight, homeservices, physio, realestate, taxi, vets | Receita Federal CNPJ open data, whole Brazilian company register (10 huge zips) | email on ~46-72% of active head offices, phone on most — but **42-70% of those emails are free-mail** |
| `mx-denue` | accounting, childcare, dental, realestate, vets | INEGI DENUE, one zip per state (32) | email is required, so 100% by construction; website on many |

    PRODUCT=homeservices SOURCE=fr-rge DRY_RUN=1 ./node_modules/.bin/tsx bulk-import.ts   # counts only
    PRODUCT=homeservices SOURCE=fr-rge ./node_modules/.bin/tsx bulk-import.ts             # insert, all on hold

### Brazil and Mexico are WORK-UNIT based (they are far too big for one run)
Neither can be done in one pass, and **nothing is ever written to disk** — every archive is inflated straight
off the network and parsed row by row, so a run needs no free space at all. The work unit is chosen with
environment variables, which `bulk-import.ts` passes through:

    # BRAZIL — one Estabelecimentos file (0-9) per run, per vertical.
    # FILE=1..9 is ~342 MB compressed / ~1.08 GB of CSV / ~5.4M rows; FILE=0 is the ~2.1 GB tail.
    PRODUCT=dental SOURCE=br-cnpj FILE=1 DRY_RUN=1 ./node_modules/.bin/tsx bulk-import.ts
    PRODUCT=dental SOURCE=br-cnpj FILE=1 ./node_modules/.bin/tsx bulk-import.ts
    # Resume a file that ran out of time: nextRow from the previous run's output.
    PRODUCT=dental SOURCE=br-cnpj FILE=1 START_ROW=3200000 ./node_modules/.bin/tsx bulk-import.ts
    # Options: MAX_ROWS caps the rows read, MAX_COMPRESSED_BYTES caps the download,
    # SKIP_NAME_JOIN=1 skips the Empresas pass (much faster; loses the rows that have
    # no nome fantasia, and loses the porte/capital size filter).

    # MEXICO — one or more states per run (INEGI codes 01..32; default all 32).
    PRODUCT=dental SOURCE=mx-denue STATES=09,15 DRY_RUN=1 ./node_modules/.bin/tsx bulk-import.ts
    PRODUCT=dental SOURCE=mx-denue STATES=09,15 ./node_modules/.bin/tsx bulk-import.ts

Rough cost per run on the mini: a Brazilian file is ~3 minutes to stream, and the Empresas legal-name join adds
up to ~9 more (it streams the range-partitioned company files, ~1.4 GB compressed, for the names and the
`porte_empresa`/`capital_social` size filter), so budget ~12-15 minutes per file per vertical and keep it under
the 40-minute deadline. Mexico is ~1 minute for a small state and ~3 for CDMX. Full coverage is
10 files x 9 verticals for Brazil and 32 states x 5 verticals for Mexico, so it is a background campaign run a
few units at a time, not a single job.

**Brazil's contador problem.** A Brazilian company routinely registers its ACCOUNTANT's email as its CNPJ
contact address, and one accountant's address can sit on hundreds of unrelated companies. So `br-cnpj` rejects
any email whose domain reads as an accounting office for every vertical **except** `accounting`, where that
domain is the business we actually want.

### THE HOLD — what actually stops an international email going out
Every lead from these sources is stored `region_blocked = true` with
`signals.intlHold = { country, reason: 'international: pending compliance review' }`. The flag is set in ONE
place, `discovery/pipeline.ts registryLeadRow`, so no source can forget it. A held lead is completely inert:

- `stageEnrich` skips region-blocked leads, so not even its website is looked up;
- `stageDraft` and the contact-form stage only select `region_blocked = false`;
- `sender.ts` re-reads the flag at send time and refuses.

So importing a country is safe on its own. Getting out of the hold is a separate, manual, per-country decision
that should follow a compliance review of that country's marketing-email rules:

    COUNTRY=FR PRODUCT=homeservices DRY_RUN=1 ./node_modules/.bin/tsx release-country.ts   # count what is held
    COUNTRY=FR PRODUCT=homeservices ./node_modules/.bin/tsx release-country.ts             # release

It matches on the stored hold, not on the location text, and updates only the ids it just listed, so it can
never touch more than it reported. `signals.intlHold` is left in place as the audit trail.
**DE, AT, CH and LI are refused outright** and can never be released: they require prior consent even for B2B
marketing email (`discovery/score.ts` region-blocks them by location and domain as well).

### Filters that exist for legal reasons, not for quality
- **UK (both sources): PECR.** Marketing email to an individual or a non-corporate partnership needs consent;
  to a corporate subscriber it does not. So `uk-cqc` keeps only providers whose name carries a corporate legal
  form (Ltd/PLC/LLP/CIC) and `uk-dvsa` keeps only `OperatorType = 'Limited Company'`. This throws away real
  businesses on purpose — roughly 4,900 CQC dentists and 21,000 DVSA operators.
- **France / Norway: sole traders.** An entreprise individuelle (FR) or enkeltpersonforetak (ENK, NO) may have
  registered contact details that are the owner's personal data. Those rows are kept but scored down hard and
  flagged in `signals.reasons` so a reviewer sees it.
- **France: foreign establishments.** The RGE register also lists non-French companies (postcode `00000`,
  placeholder SIREN). They are rejected, so nothing gets a French location or a French-language draft wrongly.

### Draft language
`signals.registry.state` / `location` is written `"<Town>, <CC>"` — `"Lyon, FR"`, `"Bergen, NO"`,
`"London, GB"` — and `outreach/language.ts` maps the trailing code: FR -> French, NO -> Norwegian,
GB/IE -> English (the default). Every code in that map is checked against the US state codes, so `"Dover, DE"`
is Delaware and never Germany.

### Verified but NOT built
- **Mexico, INEGI DENUE.** Works and has email: the CDMX state file is 462,732 establishments, 22.6% with
  `correoelec` (note: the column is `correoelec`, not `correo_e`) and 10.6% with `www`. Fill rate is better for
  our verticals — SCIAN 6212 dental 2,278/7,467 (31%), 5242 insurance brokers 286/479 (60%), 4841 freight
  342/511 (67%), 2382 plumbing/HVAC 174/482 (36%), 6233 home care 53/109 (49%). Not built only because it is one
  ~45 MB zip per state for 32 states and the download runs at roughly 9 minutes per state from here.
- **Brazil, Receita Federal CNPJ dump.** Could not be verified: `dadosabertos.rfb.gov.br`,
  `arquivos.receitafederal.gov.br` and the mirrors all refused or timed out from here. Not built.

## Contact-form submission worker (`form-submit.ts`)
Leads with no public email get a draft in the queue's **forms** tab. A human reads it and clicks
**Submit for me**, which moves `signals.formOutreach.status` to `queued`. This worker is the only thing
that picks `queued` up, and `queued` is the only status it will touch — nothing is ever submitted
without that click.

- One-time setup on the mini: `cd ~/calldesk-outreach-harness/repo/harness/outreach && npm i && npx playwright install chromium`
- Env (`~/.calldesk-forms/env`, chmod 600): `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `OUTREACH_REPLYTO_EMAIL` (the address put in the form's email field; falls back to the address part of
  `OUTREACH_FROM_EMAIL`), optional `OUTREACH_FORM_SUBMIT_MAX_PER_DAY` (default 15, hard max 50), optional `PRODUCT`.
- Run once now: `cd ~/calldesk-outreach-harness/repo/harness/outreach && set -a && . ~/.calldesk-forms/env && set +a && ./node_modules/.bin/tsx form-submit.ts`
- Dry run (reads + gates, no browser, no writes): prefix `DRY_RUN=1`.
- Schedule: `com.calldesk.outreach-formsubmit.plist.template` (every 20 min, via `form_submit_cycle.sh`).
- Stop everything now: `touch ~/.calldesk-forms/STOP`
- Logs / history / screenshots: `~/.calldesk-forms/logs/`, `~/.calldesk-forms/runs.jsonl`, `~/.calldesk-forms/<leadId>/{before,after}.png`
- Limits in code: 15/day (`OUTREACH_FORM_SUBMIT_MAX_PER_DAY`), 5/hour, 1 per domain per day, one submission
  per lead ever, random 20–40 s gaps, 25-minute deadline, lock against overlapping runs, and a circuit
  breaker that stops the run after 5 consecutive failed/unconfirmed attempts (reason written to
  `~/.calldesk-forms/circuit-breaker.txt`).
- Refusals, all landing in `needs_manual` with a reason for a human to finish by hand: **any** captcha or
  bot challenge (never solved or bypassed), a third-party embedded form, a required phone number, a required
  marketing opt-in, unrecognised required fields, and — importantly — an **unconfirmed** result. `submitted`
  is only ever set on positive evidence of receipt (navigation to a success page, the form disappearing with
  confirmation text, or an explicit success element). A silent page is not success.
- Suppressed domains, `region_blocked` leads and leads that already replied are skipped outright.
- The browser is a stock headless Chromium with a normal Chromium user agent: no stealth plugins, no evasion,
  no proxy rotation. It fills the site's own public contact form with a real message and a real reply address.
