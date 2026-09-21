# Calldesk discovery: new signal sources + evidence-based scoring

## Context

Calldesk's outreach discovery today has two sources — the Retell partner directory
(`src/lib/outreach/discovery/retellDirectory.ts`) and rotating Claude web searches
(`discovery/searchSource.ts`) — both aimed at agencies that build/resell voice-AI
phone agents. The goal is to widen the kinds of signal used to find and qualify
those agencies, and to make the existing score explainable rather than a bare
number, without expanding scope to SimplyApply or the Kreative Koala pipeline
(they stay as they are; this is Calldesk-only for now).

Notably, the DB's `signal_source` check constraint already allows `job_posting`,
`review_site`, and `tech_fingerprint` (added in migrations 015/029) — these
categories were evidently planned for at the outset and never implemented. This
spec fills that gap rather than inventing new categories.

Chosen scope, from brainstorming:
- New discovery: job postings, review sites (G2/Capterra/Clutch), GitHub/dev signal.
- Not new discovery, but better scoring: tech fingerprinting — confirms a lead
  already found some other way is an active reseller of a competing platform.
- Public pages and public search only, same compliance posture as today (no
  scraping behind logins or against ToS).

## Design

### 1. Generalize the search-discovery loop

`discovery/searchSource.ts`'s `findSearchCandidates`/`runQuery` loop (search →
parse JSON array → verify each candidate's own site) is duplicated, not
Calldesk-specific in its mechanics. Extract it into:

**`discovery/genericSource.ts`**
```ts
export interface SourceSpec {
  signalSource: 'job_posting' | 'review_site' | 'search'; // matches DB check constraint (github reuses 'search')
  queriesForDay(now: Date, perDay: number): string[];
  promptFor(query: string): string;               // must ask for the same {name, website, location, blurb} JSON shape
  hostExclusions: string[];                        // beyond the shared defaults (social/platform hosts)
  verify(domain: string): Promise<boolean>;         // defaults to the existing LOOKS_LIKE_VOICE_AI check
}
export async function findCandidates(spec: SourceSpec, perDay: number, shouldStop: () => boolean): Promise<{...}>
```
`searchSource.ts` becomes a thin `SourceSpec` (the existing agency-search prompt/queries)
passed through `genericSource.ts`, so its existing behavior and tests are unchanged.

### 2. Three new sources, each a small `SourceSpec`

- **`discovery/jobPostings.ts`** — `signalSource: 'job_posting'`. Prompt: search
  public job boards/company career pages for agencies hiring for "Retell AI
  engineer", "Vapi integration", "voice AI agent developer" type roles — a
  posting is strong buying/building intent. Verify step reuses `LOOKS_LIKE_VOICE_AI`
  against the poster's own site (not the job board).
- **`discovery/reviewSites.ts`** — `signalSource: 'review_site'`. Prompt: search
  G2/Capterra/Clutch listings/reviews that name a voice-AI platform in the review
  text; extract the reviewed company's own site from the listing, not the review
  site itself.
- **`discovery/githubSignal.ts`** — `signalSource: 'search'` (no dedicated DB value;
  reuses the existing generic one). Prompt: search for public repos/docs
  integrating a voice-AI SDK (Vapi, Retell, Bland) that trace back to an agency's
  org, not a hobby project — verify step additionally checks the linked site reads
  as a business, not a personal GitHub Pages README.

Each is wired into `pipeline.ts` as its own stage (`stageJobPostings`, `stageReviewSites`,
`stageGithub`), run alongside the existing `stageDirectory`/`stageSearch`, inserting/
deduping through the same `LeadIndex` used today. Each gets its own daily query-count
env var (`OUTREACH_JOBPOSTINGS_QUERIES_PER_DAY` etc.), **defaulting to 0** (off) until
manually enabled after reviewing a first dry-run batch of each.

### 3. Tech fingerprinting — an enrichment step, not a discovery stage

**`discovery/techFingerprint.ts`**: given a domain, fetch the homepage and check for
known script-src/domain patterns of competing voice platforms (Vapi, Bland,
Synthflow, ElevenLabs Conversational, PlayAI, and Retell itself, for leads sourced
elsewhere). Returns `{ platforms: string[] }` (empty if none detected or fetch
failed — absence is not a negative signal, just no evidence).

Runs inside the existing `stageEnrich` (which already fetches each lead's domain
once), right after `findContact`. Failure is silent/best-effort, same as the rest
of that stage.

### 4. Evidence-based scoring

`scoreLead()` signature changes from `(input) => number` to
`(input, evidence?) => { score: number; reasons: string[] }`:
- `evidence.techPlatforms: string[]` — detected via fingerprinting; a hit adds a
  meaningful bonus and a human-readable reason ("confirmed Vapi reseller").
- `evidence.viaJobPosting` / `evidence.viaReviewSite: boolean` — the existing
  keyword-based bonuses in the current function become explicit, named reasons
  instead of silent point additions.
- Existing behavior (tier/description keyword bonuses) is preserved, just
  reframed as named reasons for consistency.

Callers store both the existing `score` int column (unchanged, so nothing else
that reads it breaks) and a new `signals` JSONB column holding `{ reasons, techPlatforms }`.
Migration: `ALTER TABLE calldesk_outreach_leads ADD COLUMN IF NOT EXISTS signals JSONB;`

**Admin UI**: `/admin/outreach` lead list shows the `reasons` list under the score
(e.g. "50 base + confirmed Vapi reseller (+20) + hiring for voice-AI role (+15)"),
so score is explainable at a glance rather than a bare number.

## Error handling

Every new source/stage is best-effort, matching the existing pipeline: failures
push a message onto `summary.errors` and never abort the run. Tech fingerprinting
failing to fetch a page yields no evidence, not a penalty.

## Rollout / budget

The mini already runs three outreach harnesses on shared Claude CLI quota (Calldesk
hourly-ish, SimplyApply's drip 5x/day, Kreative Koala's app-outreach every 30 min
during its current burst window). New Calldesk query caps default to **0** so
nothing changes until explicitly turned on per source, then start at **2
queries/day** each (mirrors the existing `OUTREACH_SEARCH_QUERIES_PER_DAY` default
of 3), reviewed manually in the queue before raising.

## Testing

- `scoreLead(evidence)`: unit tests, deterministic, no network — cover each bonus
  reason firing/not firing and the reasons list content.
- `techFingerprint`: unit tests against fixture HTML containing/lacking each
  platform's known script pattern.
- Each new `SourceSpec`: a dry run (`DRY_RUN=1`, real search/fetch, no writes),
  same check already used for the existing search stage — confirm candidates are
  found, verified, and rejected-list looks sane before ever writing to the DB.

## Files touched

New: `discovery/genericSource.ts`, `discovery/jobPostings.ts`, `discovery/reviewSites.ts`,
`discovery/githubSignal.ts`, `discovery/techFingerprint.ts`, a migration adding `signals` JSONB.
Modified: `discovery/searchSource.ts` (becomes a `SourceSpec` using `genericSource.ts`),
`discovery/score.ts` (`scoreLead` returns `{score, reasons}`), `discovery/pipeline.ts`
(three new stages + fingerprint call in `stageEnrich` + store `signals`), `/admin/outreach`
lead list (show reasons).
