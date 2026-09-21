# Calldesk Discovery Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new automated lead-discovery sources (job postings, review sites, GitHub) and one automated enrichment signal (tech fingerprinting for competing platforms) to Calldesk's outreach pipeline, and make `scoreLead` explainable (score + named reasons) instead of a bare number.

**Architecture:** Extract the existing search→verify loop in `searchSource.ts` into a reusable `genericSource.ts`, so job postings, review sites, and GitHub become three more thin "source specs" plugged into it, each wired into `pipeline.ts` as its own stage exactly like today's `stageSearch`. Tech fingerprinting extends the *existing* (but currently manual-only) `signals/techFingerprint.ts` to also detect competing platforms, and gets called automatically inside `stageEnrich` instead of only from a UI button. `scoreLead` gains an `evidence` parameter and returns `{ score, reasons }`; every stage that inserts or re-matches a lead stores that evidence in a new `signals` JSONB column.

**Tech Stack:** TypeScript, Next.js API routes, Supabase (Postgres), `claude` CLI (via `src/lib/outreach/llm.ts`) for search/fetch, `cheerio` where needed. No test framework exists in this repo — verification throughout this codebase (and this session) is small `npx tsx` scripts against real data, not a jest/vitest suite; this plan follows that established pattern rather than introducing a new one.

**Spec:** `docs/superpowers/specs/2026-09-21-calldesk-discovery-signals-design.md`

## Global Constraints

- Public pages and public search only — no scraping behind logins or against a site's ToS (same posture as every existing discovery source).
- Every new discovery stage defaults its daily query cap to **0** (off) via its own env var; nothing runs live until manually enabled after reviewing a dry-run batch.
- **Review-site discovery is explicitly user-approved to override this codebase's prior manual-only guardrail** (see `src/lib/outreach/signals/reviewSites.ts`'s original comment). Mitigation baked into this plan: the *draft email* never quotes G2/Capterra content — it only ever cites the lead's own domain, via the existing, unchanged `research.ts` trust rule (a hook is only kept if it cites a page on the lead's own domain). Review-site search only supplies a company *name* to investigate, never review text to repeat.
- `scoreLead`'s existing behavior (tier/description keyword bonuses) must be preserved exactly, just reframed as named reasons — no regression in existing scores.
- Every new/changed file must pass `npx tsc --noEmit -p tsconfig.json` with zero errors before its task is considered done.

---

## File Structure

New files:
- `src/lib/outreach/discovery/genericSource.ts` — the extracted search→parse→verify loop, parameterized by a `SourceSpec`.
- `src/lib/outreach/discovery/jobPostingsSearch.ts` — Claude-search `SourceSpec` for job postings (additive to the existing RemoteOK-based `signals/jobPostings.ts`, which is untouched).
- `src/lib/outreach/discovery/reviewSitesSearch.ts` — Claude-search `SourceSpec` for review-site mentions.
- `src/lib/outreach/discovery/githubSignal.ts` — Claude-search `SourceSpec` for GitHub/dev signal.
- `supabase/migrations/033_outreach_signals.sql` — adds the `signals` JSONB column.

Modified files:
- `src/lib/outreach/discovery/score.ts` — `scoreLead` gains an `evidence` param, returns `{ score, reasons }`.
- `src/lib/outreach/discovery/searchSource.ts` — becomes a `SourceSpec` consumer of `genericSource.ts` (behavior-preserving).
- `src/lib/outreach/discovery/pipeline.ts` — three new stages, evidence merge on dedupe match, automated fingerprint call in `stageEnrich`, new env-var caps.
- `src/lib/outreach/signals/techFingerprint.ts` — add competing-platform markers alongside the existing Retell-only markers.
- `src/app/admin/outreach/page.tsx` — show score + reasons per lead.

---

### Task 1: Migration — add the `signals` column

**Files:**
- Create: `supabase/migrations/033_outreach_signals.sql`

**Interfaces:**
- Produces: a `signals JSONB` column on `calldesk_outreach_leads`, nullable, no default — later tasks write `{ reasons: string[], techPlatforms: string[] }` into it.

- [ ] **Step 1: Write the migration**

```sql
-- Evidence behind a lead's score (which signals fired, what tech fingerprinting
-- found), so the admin UI can show WHY a lead scored the way it did instead of
-- a bare number. Written by discovery/score.ts's callers; read by /admin/outreach.
ALTER TABLE calldesk_outreach_leads ADD COLUMN IF NOT EXISTS signals JSONB;
```

- [ ] **Step 2: Apply it to the shared Supabase project**

```bash
python3 - <<'EOF'
import subprocess, json, base64, urllib.request
raw = subprocess.run(["security","find-generic-password","-s","Supabase CLI","-w"],capture_output=True,text=True).stdout.strip()
if raw.startswith("go-keyring-base64:"): raw = base64.b64decode(raw.split(":",1)[1]).decode()
sql = open("supabase/migrations/033_outreach_signals.sql").read()
req = urllib.request.Request("https://api.supabase.com/v1/projects/uazpbuvqisbpykiuebbn/database/query",
  data=json.dumps({"query": sql}).encode(), headers={"Authorization":"Bearer "+raw,"Content-Type":"application/json","User-Agent":"curl/8"}, method="POST")
try:
    r = urllib.request.urlopen(req, timeout=60); print("migration 033: HTTP", r.status)
except urllib.error.HTTPError as e: print("HTTP", e.code, e.read().decode()[:500])
EOF
```
Expected: `migration 033: HTTP 201`.

- [ ] **Step 3: Verify the column exists**

```bash
python3 - <<'EOF'
import subprocess, json, base64, urllib.request
raw = subprocess.run(["security","find-generic-password","-s","Supabase CLI","-w"],capture_output=True,text=True).stdout.strip()
if raw.startswith("go-keyring-base64:"): raw = base64.b64decode(raw.split(":",1)[1]).decode()
req = urllib.request.Request("https://api.supabase.com/v1/projects/uazpbuvqisbpykiuebbn/database/query",
  data=json.dumps({"query": "select column_name from information_schema.columns where table_name='calldesk_outreach_leads' and column_name='signals'"}).encode(),
  headers={"Authorization":"Bearer "+raw,"Content-Type":"application/json","User-Agent":"curl/8"}, method="POST")
print(json.load(urllib.request.urlopen(req, timeout=60)))
EOF
```
Expected: `[{'column_name': 'signals'}]`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/033_outreach_signals.sql
git commit -m "Add signals JSONB column to calldesk_outreach_leads

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Evidence-based `scoreLead`

**Files:**
- Modify: `src/lib/outreach/discovery/score.ts` (full file, ~45 lines today)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export interface ScoreEvidence { viaJobPosting?: boolean; viaReviewSite?: boolean; techPlatforms?: string[] }` and
  `export function scoreLead(input: ScoreInput, evidence?: ScoreEvidence): { score: number; reasons: string[] }`.
  Every existing caller of `scoreLead(input)` (currently `pipeline.ts` lines ~143 and ~215) must be updated in Task 8 to use the new return shape — noted here so later tasks know the exact signature they're matching.

- [ ] **Step 1: Write the verification script (no test framework in this repo — this is how verification is done here)**

Create `/tmp/verify_score.ts` (or your scratchpad equivalent):
```ts
import { scoreLead } from '/Users/sushanthtiruvaipati/Documents/github/calldesktech/src/lib/outreach/discovery/score';

const base = scoreLead({ tier: null, location: null, description: null });
console.log('base score (expect 50, reasons []):', base);

const gold = scoreLead({ tier: 'gold', location: null, description: null });
console.log('gold tier (expect 65):', gold.score, gold.reasons);

const reseller = scoreLead({ tier: null, location: null, description: 'white-label reseller for small businesses' });
console.log('reseller+smb (expect base+20+10=80):', reseller.score, reseller.reasons);

const withEvidence = scoreLead({ tier: null, location: null, description: null }, { techPlatforms: ['Vapi'], viaJobPosting: true });
console.log('tech+job evidence (expect > 50, 2 reasons mentioning Vapi and job posting):', withEvidence.score, withEvidence.reasons);
```
Run: `npx tsx /tmp/verify_score.ts`
Expected: it will fail (TypeScript error: `scoreLead` doesn't return `.reasons`, and the 4-arg evidence overload doesn't exist) — confirming the change is needed.

- [ ] **Step 2: Rewrite `score.ts`**

```ts
// Rule-based fit score (0-100) for agency leads, with named reasons so the
// admin UI can show WHY a lead scored the way it did. Deliberately simple and
// explainable, no model calls. Higher = more likely to want a cheaper second
// platform and to resell it.

export interface ScoreInput {
  tier: string | null;
  location: string | null;
  description: string | null;
}

// Evidence gathered by discovery stages beyond the directory/search blurb:
// which additional signal sources fired, and what tech fingerprinting found
// on the lead's own site (which competing platforms it references).
export interface ScoreEvidence {
  viaJobPosting?: boolean;
  viaReviewSite?: boolean;
  techPlatforms?: string[];
}

export interface ScoreResult {
  score: number;
  reasons: string[];
}

// Regions excluded from cold email. Germany, Austria and Switzerland require prior
// consent even for B2B marketing email (unfair-competition law), so we skip them.
// Everywhere else (incl. the UK and the rest of the EU) is allowed, relying on B2B
// legitimate interest plus sender identity, postal address and an unsubscribe link
// in every email. Review this list with counsel before scaling volume.
const BLOCKED_REGION_HINTS = ['germany', 'deutschland', 'austria', 'switzerland', 'liechtenstein', 'gmbh'];

// Country-code domains for the same regions; catches agencies whose listing has no location.
const BLOCKED_TLDS = ['.de', '.at', '.ch', '.li'];

export function isBlockedDomain(domain: string | null): boolean {
  const d = (domain || '').toLowerCase();
  return BLOCKED_TLDS.some((t) => d.endsWith(t));
}

export function isRegionBlocked(location: string | null, name = ''): boolean {
  const hay = `${location || ''} ${name}`.toLowerCase();
  return BLOCKED_REGION_HINTS.some((h) => hay.includes(h));
}

export function scoreLead(input: ScoreInput, evidence?: ScoreEvidence): ScoreResult {
  const tier = (input.tier || '').toLowerCase();
  const desc = (input.description || '').toLowerCase();
  let score = 50;
  const reasons: string[] = [];

  const add = (delta: number, reason: string) => {
    score += delta;
    reasons.push(`${delta >= 0 ? '+' : ''}${delta}: ${reason}`);
  };

  if (tier.includes('gold')) add(15, 'Retell gold-tier partner');
  else if (tier.includes('elite') || tier.includes('diamond')) add(-10, 'top-tier partner (likely already well-served)');

  if (/white.?label|reseller|resell/.test(desc)) add(20, 'describes itself as a white-label reseller');
  if (/small business|smb|local business|receptionist|home services|dental|real estate|trades/.test(desc)) add(10, 'targets SMB/local-business verticals');
  if (/inbound|outbound|voice agent|voice ai/.test(desc)) add(5, 'explicitly does voice-AI work');
  if (/enterprise|call center|contact center/.test(desc)) add(-5, 'enterprise/call-center focus (harder to switch)');

  if (evidence?.viaJobPosting) add(15, 'publicly hiring for a voice-AI role');
  if (evidence?.viaReviewSite) add(10, 'named in a public review as a voice-AI provider');
  for (const platform of evidence?.techPlatforms ?? []) {
    add(20, `confirmed ${platform} integration on their own site`);
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}
```

- [ ] **Step 3: Re-run the verification script**

Run: `npx tsx /tmp/verify_score.ts`
Expected:
```
base score (expect 50, reasons []): { score: 50, reasons: [] }
gold tier (expect 65): 65 [ '+15: Retell gold-tier partner' ]
reseller+smb (expect base+20+10=80): 80 [ '+20: describes itself as a white-label reseller', '+10: targets SMB/local-business verticals' ]
tech+job evidence (expect > 50, 2 reasons mentioning Vapi and job posting): 90 [ '+15: publicly hiring for a voice-AI role', '+20: confirmed Vapi integration on their own site' ]
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep score.ts`
Expected: no output (this file has zero errors). The repo-wide typecheck will still show errors from `pipeline.ts` calling the old `scoreLead` signature — that's expected until Task 8; don't fix `pipeline.ts` here.

- [ ] **Step 5: Commit**

```bash
git add src/lib/outreach/discovery/score.ts
git commit -m "score.ts: scoreLead returns {score, reasons} and accepts new-signal evidence

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Extract `genericSource.ts`; make `searchSource.ts` a consumer

**Files:**
- Create: `src/lib/outreach/discovery/genericSource.ts`
- Modify: `src/lib/outreach/discovery/searchSource.ts` (full file, ~139 lines today)

**Interfaces:**
- Produces: `export interface SourceSpec { signalSource: string; queriesForDay(now: Date, perDay: number): string[]; promptFor(query: string): string; hostExclusions: string[]; verify(domain: string): Promise<boolean> }`
  and `export async function findCandidates(spec: SourceSpec, perDay: number, shouldStop: () => boolean): Promise<{ candidates: SearchCandidate[]; errors: string[]; raw: number; rejected: string[] }>`
  where `SearchCandidate` is the existing `{ name: string; domain: string; location: string | null; blurb: string | null }` shape from `searchSource.ts` — move that interface into `genericSource.ts` and re-export it from `searchSource.ts` so nothing importing `SearchCandidate` from `searchSource.ts` breaks.
- Consumes: `cliComplete`, `extractJson` from `../llm`; `hostOf` from `./findDomain`; `politeFetchText` from `./http` (all unchanged imports, just moved to the new file).

- [ ] **Step 1: Write `genericSource.ts`**

```ts
import { hostOf } from './findDomain';
import { politeFetchText } from './http';
import { cliComplete, extractJson } from '../llm';

// Shared search -> parse -> verify loop used by every Claude-web-search-based
// discovery source (agency search, job postings, review sites, GitHub signal).
// Each source supplies its own SourceSpec (prompt, query rotation, host
// exclusions, and how to verify a candidate's own site); this file owns the
// mechanics (JSON parsing, dedupe-by-domain, best-effort error handling).

export interface SearchCandidate {
  name: string;
  domain: string;
  location: string | null;
  blurb: string | null;
}

export interface SourceSpec {
  // Matches the calldesk_outreach_leads.signal_source check constraint
  // ('job_posting' | 'review_site' | 'directory' | 'search' | ...).
  signalSource: string;
  queriesForDay(now: Date, perDay: number): string[];
  promptFor(query: string): string;
  hostExclusions: string[];
  verify(domain: string): Promise<boolean>;
}

const DEFAULT_EXCLUDED_HOSTS = ['linkedin.com', 'facebook.com', 'youtube.com', 'reddit.com', 'yelp.com', 'wikipedia.org', 'google.com', 'twitter.com', 'x.com'];

function parseJsonArray(text: string): unknown[] {
  const parsed = extractJson<unknown[]>(text, 'array');
  return Array.isArray(parsed) ? parsed : [];
}

async function runQuery(spec: SourceSpec, query: string): Promise<unknown[]> {
  return parseJsonArray(cliComplete(spec.promptFor(query), { webSearch: true, maxTurns: 14, timeoutMs: 300_000 }));
}

export async function findCandidates(
  spec: SourceSpec,
  perDay: number,
  shouldStop: () => boolean = () => false,
): Promise<{ candidates: SearchCandidate[]; errors: string[]; raw: number; rejected: string[] }> {
  const errors: string[] = [];
  let raw = 0;
  const byDomain = new Map<string, SearchCandidate>();
  const excluded = [...DEFAULT_EXCLUDED_HOSTS, ...spec.hostExclusions];
  const queries = spec.queriesForDay(new Date(), perDay);

  for (const query of queries) {
    if (shouldStop()) break;
    try {
      const found = await runQuery(spec, query);
      raw += found.length;
      for (const entry of found) {
        const item = entry as { name?: unknown; website?: unknown; location?: unknown; blurb?: unknown };
        if (typeof item.name !== 'string' || typeof item.website !== 'string') continue;
        const domain = hostOf(item.website);
        if (!domain || excluded.some((h) => domain === h || domain.endsWith(`.${h}`))) continue;
        if (byDomain.has(domain)) continue;
        byDomain.set(domain, {
          name: item.name.trim().slice(0, 120),
          domain,
          location: typeof item.location === 'string' ? item.location.trim().slice(0, 120) : null,
          blurb: typeof item.blurb === 'string' ? item.blurb.trim().slice(0, 400) : null,
        });
      }
    } catch (error) {
      errors.push(`search "${query}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const verified: SearchCandidate[] = [];
  const rejected: string[] = [];
  for (const candidate of byDomain.values()) {
    if (shouldStop()) break;
    if (await spec.verify(candidate.domain)) verified.push(candidate);
    else rejected.push(candidate.domain);
  }
  return { candidates: verified, errors, raw, rejected };
}

// Shared default verify(): the candidate's homepage must load and read like
// a voice/AI business. Sources whose candidates aren't voice-AI companies
// themselves (e.g. review-site mentions, which ARE voice-AI companies too)
// can reuse this; sources looking for something else (media outlets, in the
// Kreative Koala pipeline) supply their own verify().
const LOOKS_LIKE_VOICE_AI = /(voice|phone|call|receptionist|answering|ai agent|conversational)/i;
export async function verifyLooksLikeVoiceAi(domain: string): Promise<boolean> {
  const res = await politeFetchText(`https://${domain}`, 12000);
  if (!res.ok || res.text.length < 500) return false;
  return LOOKS_LIKE_VOICE_AI.test(res.text.slice(0, 200_000));
}
```

- [ ] **Step 2: Rewrite `searchSource.ts` to consume it (behavior-preserving)**

```ts
import { getAnthropicClient } from '@/lib/anthropic';
import { hostOf } from './findDomain';
import { cliComplete, usingCli } from '../llm';
import { findCandidates, verifyLooksLikeVoiceAi, type SourceSpec, type SearchCandidate } from './genericSource';

// Finds agencies that build/sell AI voice agents on ANY platform by running a
// few rotating web searches per day through Claude's server-side web search.
// The model only proposes candidates; nothing it says is trusted until the
// candidate's own website is fetched and actually looks like a voice/AI
// business (guards against invented companies or URLs).
//
// This is now a thin SourceSpec over the shared loop in genericSource.ts;
// findSearchCandidates/queriesForDay keep their exact prior behavior and
// signatures so pipeline.ts's existing stageSearch needs no changes.

export type { SearchCandidate };

const VERTICALS = [
  'dental practices', 'real estate agents', 'home services (HVAC, plumbing, roofing)', 'law firms', 'medical clinics',
  'insurance agencies', 'restaurants', 'auto dealerships', 'property management companies', 'salons and spas',
  'chiropractors', 'veterinary clinics', 'contractors and trades', 'financial advisors', 'senior living and home care',
];
const PHRASINGS = ['AI voice agent agency for', 'AI receptionist company for', 'AI phone answering service built for'];
const REGIONS = [
  'the United Kingdom', 'Ireland', 'the Netherlands', 'France', 'Spain', 'Italy', 'Poland', 'Sweden and the Nordics',
  'Canada', 'Australia and New Zealand', 'India', 'the UAE and Middle East', 'Singapore and Southeast Asia',
  'Brazil and Latin America', 'South Africa',
];

// Deterministic rotation: each day advances through vertical x phrasing combos.
export function queriesForDay(now = new Date(), perDay = 3): string[] {
  const combos = [
    ...VERTICALS.flatMap((v) => PHRASINGS.map((p) => `${p} ${v}`)),
    ...REGIONS.flatMap((r) => ['AI voice agent agency in', 'AI receptionist and phone agent company in'].map((p) => `${p} ${r}`)),
  ];
  const dayNumber = Math.floor(now.getTime() / 86_400_000);
  return Array.from({ length: perDay }, (_, i) => combos[(dayNumber * perDay + i) % combos.length]);
}

const PLATFORM_HOSTS = ['retellai.com', 'vapi.ai', 'bland.ai', 'synthflow.ai', 'elevenlabs.io', 'poly.ai', 'openai.com', 'microsoft.com', 'amazon.com', 'twilio.com', 'g2.com', 'capterra.com', 'clutch.co'];

const PROMPT = (query: string) => `Search the web for: ${query}

I want small and mid-size agencies, studios or consultancies that BUILD or SELL AI voice agents / AI phone receptionists to other businesses. Exclude the voice-AI platforms themselves (Retell, Vapi, Bland, Synthflow, ElevenLabs, PolyAI), big enterprises, directories, and review or listicle sites.

Return ONLY a JSON array (at most 12 items) of objects with keys: name, website (the company's own homepage URL, taken from the search results), location (city and country if shown, else null), blurb (one factual sentence from their own site). Only include companies you actually saw in the search results. Use at most 4 web searches, then answer immediately. No commentary, no markdown fences.`;

export async function verifyCandidateSite(domain: string): Promise<boolean> {
  return verifyLooksLikeVoiceAi(domain);
}

const SPEC: SourceSpec = {
  signalSource: 'search',
  queriesForDay,
  promptFor: PROMPT,
  hostExclusions: PLATFORM_HOSTS,
  verify: verifyLooksLikeVoiceAi,
};

export async function findSearchCandidates(
  queries: string[],
  shouldStop: () => boolean = () => false,
): Promise<{ candidates: SearchCandidate[]; errors: string[]; raw: number; rejected: string[] }> {
  // findCandidates recomputes its own queriesForDay(perDay) internally; the
  // caller-supplied `queries` list here is only used for its length, to
  // preserve the exact prior call shape pipeline.ts already uses.
  return findCandidates(SPEC, queries.length, shouldStop);
}
```

Note: the old file had a `usingCli`/direct-Anthropic-client fallback path for non-CLI use inside `runQuery`. `genericSource.ts`'s `findCandidates` always uses the CLI path (`cliComplete`) — check `getAnthropicClient` and `usingCli` are still imported above only because `agencyDraft.ts` and other files use that pattern elsewhere; if `searchSource.ts` no longer needs them after this rewrite, remove those two unused imports so the typecheck in Step 4 doesn't warn on unused imports.

- [ ] **Step 3: Fix unused imports**

Re-open `searchSource.ts` and delete the `getAnthropicClient` and `usingCli` imports (the rewritten file above doesn't call either) — the final import line should just be:
```ts
import { hostOf } from './findDomain';
import { findCandidates, verifyLooksLikeVoiceAi, type SourceSpec, type SearchCandidate } from './genericSource';

export type { SearchCandidate };
```
(`hostOf` is also unused in the rewritten file — remove it too if `npx tsc`/eslint flags it as unused.)

- [ ] **Step 4: Typecheck and regression-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "genericSource|searchSource"`
Expected: no output.

Run a real dry-run smoke test to confirm behavior is unchanged from before the refactor:
```ts
// /tmp/verify_searchsource.ts
import { queriesForDay, findSearchCandidates } from '/Users/sushanthtiruvaipati/Documents/github/calldesktech/src/lib/outreach/discovery/searchSource';
(async () => {
  const qs = queriesForDay(new Date(), 1);
  console.log('1 query for today:', qs);
  const { candidates, errors, raw } = await findSearchCandidates(qs);
  console.log(`raw=${raw} verified=${candidates.length} errors=${errors.length}`);
  console.log(candidates.slice(0, 2));
})();
```
Run: `npx tsx /tmp/verify_searchsource.ts`
Expected: completes without throwing, prints a `raw`/`verified` count and up to 2 sample candidates (exact numbers will vary run to run — the check is that it runs end-to-end with no errors thrown, matching pre-refactor behavior).

- [ ] **Step 5: Commit**

```bash
git add src/lib/outreach/discovery/genericSource.ts src/lib/outreach/discovery/searchSource.ts
git commit -m "Extract genericSource.ts from searchSource.ts (behavior-preserving)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Job-postings Claude-search source

**Files:**
- Create: `src/lib/outreach/discovery/jobPostingsSearch.ts`

**Interfaces:**
- Consumes: `findCandidates`, `verifyLooksLikeVoiceAi`, `SourceSpec` from `./genericSource`.
- Produces: `export async function findJobPostingCandidates(perDay: number, shouldStop: () => boolean): Promise<{ candidates: SearchCandidate[]; errors: string[]; raw: number; rejected: string[] }>`, `export function jobPostingQueriesForDay(now: Date, perDay: number): string[]`.
- This is ADDITIVE to `src/lib/outreach/signals/jobPostings.ts` (RemoteOK feed) — that file is untouched and still reachable from the manual "Scan job postings" button; `pipeline.ts` (Task 8) will call both and merge results.

- [ ] **Step 1: Write the file**

```ts
import { findCandidates, verifyLooksLikeVoiceAi, type SourceSpec, type SearchCandidate } from './genericSource';

// Finds agencies publicly hiring for voice-AI-related roles via Claude web
// search — broader coverage than the RemoteOK-only feed in
// ../signals/jobPostings.ts (which stays in place; pipeline.ts merges both).
// A live job posting for "Retell engineer" or similar is a strong signal
// they're actively building/scaling this, not just dabbling.

export type { SearchCandidate };

const ROLE_QUERIES = [
  'agency hiring Retell AI engineer job posting',
  'agency hiring Vapi voice AI developer job posting',
  'agency hiring "voice AI agent" engineer job posting',
  'agency hiring conversational AI phone engineer job posting',
  'company job posting "AI receptionist" build voice agents',
];

export function jobPostingQueriesForDay(now = new Date(), perDay = 2): string[] {
  const dayNumber = Math.floor(now.getTime() / 86_400_000);
  return Array.from({ length: perDay }, (_, i) => ROLE_QUERIES[(dayNumber + i) % ROLE_QUERIES.length]);
}

const PROMPT = (query: string) => `Search the web for: ${query}

I want to find small/mid-size agencies (not the voice-AI platforms themselves, not big enterprises) that have PUBLICLY POSTED a job opening for a role building or integrating AI voice agents / voice AI phone systems for their own clients. This is a hiring-intent signal, not a general company search.

Return ONLY a JSON array (at most 10 items) of objects with keys: name (the hiring company), website (their own homepage URL, from the search results — not the job board's URL), location (if shown, else null), blurb (the job title or a one-sentence description of the role, so it's clear this came from an actual posting). Only include companies you actually saw posting such a role in the search results. Use at most 4 web searches, then answer immediately. No commentary, no markdown fences.`;

const EXCLUDED_HOSTS = ['indeed.com', 'linkedin.com', 'glassdoor.com', 'ziprecruiter.com', 'remoteok.com', 'weworkremotely.com', 'retellai.com', 'vapi.ai', 'bland.ai'];

const SPEC: SourceSpec = {
  signalSource: 'job_posting',
  queriesForDay: jobPostingQueriesForDay,
  promptFor: PROMPT,
  hostExclusions: EXCLUDED_HOSTS,
  verify: verifyLooksLikeVoiceAi,
};

export async function findJobPostingCandidates(perDay: number, shouldStop: () => boolean = () => false) {
  return findCandidates(SPEC, perDay, shouldStop);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep jobPostingsSearch`
Expected: no output.

- [ ] **Step 3: Dry-run smoke test**

```ts
// /tmp/verify_jobpostings.ts
import { findJobPostingCandidates, jobPostingQueriesForDay } from '/Users/sushanthtiruvaipati/Documents/github/calldesktech/src/lib/outreach/discovery/jobPostingsSearch';
(async () => {
  console.log('queries:', jobPostingQueriesForDay(new Date(), 1));
  const { candidates, raw, rejected, errors } = await findJobPostingCandidates(1);
  console.log(`raw=${raw} verified=${candidates.length} rejected=${rejected.length} errors=${errors.length}`);
  console.log(candidates.slice(0, 3));
})();
```
Run: `npx tsx /tmp/verify_jobpostings.ts`
Expected: completes without throwing; prints a candidate count (may be 0 or more depending on what's currently postable — the check is no exceptions and valid-looking output).

- [ ] **Step 4: Commit**

```bash
git add src/lib/outreach/discovery/jobPostingsSearch.ts
git commit -m "Add Claude-search job-postings discovery source (additive to RemoteOK feed)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Review-sites Claude-search source

**Files:**
- Create: `src/lib/outreach/discovery/reviewSitesSearch.ts`

**Interfaces:**
- Same shape as Task 4: `export async function findReviewSiteCandidates(perDay, shouldStop)`, `export function reviewSiteQueriesForDay(now, perDay)`.

**User-approved override note (repeat here for the implementer, per Global Constraints):** this codebase previously kept review-site signal manual-only over ToS/optics concerns (see `../signals/reviewSites.ts`'s comment). The user explicitly asked to automate it anyway. The mitigation is structural, not just a comment: this file only ever returns a company **name** to investigate — never review text — and the existing `research.ts`/`agencyDraft.ts` draft pipeline (unchanged by this plan) only ever quotes a hook that cites a page on the lead's *own* domain. Do not add any code path that copies review-site text into a lead's `description` or a draft's body.

- [ ] **Step 1: Write the file**

```ts
import { findCandidates, verifyLooksLikeVoiceAi, type SourceSpec, type SearchCandidate } from './genericSource';

// Finds agencies mentioned in public reviews on G2/Capterra/Clutch as voice-AI
// providers, via Claude web search (not scraping those sites directly).
//
// IMPORTANT: this source returns only a company NAME + the fact that they were
// reviewed as a voice-AI provider — never review text itself. The lead's
// `description`/`signal_detail` here is a generic label, not a quote. The
// drafted email (research.ts / agencyDraft.ts, unchanged) only ever cites a
// verified page on the LEAD'S OWN domain, never anything from the review site.

export type { SearchCandidate };

const QUERIES = [
  'G2 review AI voice agent agency for business',
  'Capterra review voice AI phone agent agency',
  'Clutch review AI receptionist agency for clients',
];

export function reviewSiteQueriesForDay(now = new Date(), perDay = 1): string[] {
  const dayNumber = Math.floor(now.getTime() / 86_400_000);
  return Array.from({ length: perDay }, (_, i) => QUERIES[(dayNumber + i) % QUERIES.length]);
}

const PROMPT = (query: string) => `Search the web for: ${query}

I want to find small/mid-size agencies (not the voice-AI platforms themselves) that appear in public reviews on sites like G2, Capterra, or Clutch as providers of AI voice agents / AI phone receptionists to their own clients.

Return ONLY a JSON array (at most 10 items) of objects with keys: name (the reviewed company), website (their own homepage URL, from the search results — never a G2/Capterra/Clutch URL), location (if shown, else null), blurb (a short, GENERIC factual label such as "reviewed on G2 as a voice AI agency" — do NOT copy or paraphrase any actual review text). Only include companies you actually saw in the search results. Use at most 4 web searches, then answer immediately. No commentary, no markdown fences.`;

const EXCLUDED_HOSTS = ['g2.com', 'capterra.com', 'clutch.co', 'trustpilot.com', 'retellai.com', 'vapi.ai', 'bland.ai'];

const SPEC: SourceSpec = {
  signalSource: 'review_site',
  queriesForDay: reviewSiteQueriesForDay,
  promptFor: PROMPT,
  hostExclusions: EXCLUDED_HOSTS,
  verify: verifyLooksLikeVoiceAi,
};

export async function findReviewSiteCandidates(perDay: number, shouldStop: () => boolean = () => false) {
  return findCandidates(SPEC, perDay, shouldStop);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep reviewSitesSearch`
Expected: no output.

- [ ] **Step 3: Dry-run smoke test, and manually confirm no review text leaked**

```ts
// /tmp/verify_reviewsites.ts
import { findReviewSiteCandidates, reviewSiteQueriesForDay } from '/Users/sushanthtiruvaipati/Documents/github/calldesktech/src/lib/outreach/discovery/reviewSitesSearch';
(async () => {
  console.log('queries:', reviewSiteQueriesForDay(new Date(), 1));
  const { candidates, raw, rejected, errors } = await findReviewSiteCandidates(1);
  console.log(`raw=${raw} verified=${candidates.length} rejected=${rejected.length} errors=${errors.length}`);
  for (const c of candidates) console.log(c.name, '|', c.domain, '|', c.blurb);
})();
```
Run: `npx tsx /tmp/verify_reviewsites.ts`
Expected: completes without throwing. Manually read each printed `blurb` — it must read as a generic label ("reviewed on G2 as...", "listed on Capterra as..."), never a quoted sentence describing specific results/pricing/customers (which would indicate review text leaked through). If any blurb looks like a copied review, tighten the prompt's wording before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/outreach/discovery/reviewSitesSearch.ts
git commit -m "Add Claude-search review-sites discovery source (user-approved override of prior manual-only guardrail; never quotes review text)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: GitHub/dev-signal source

**Files:**
- Create: `src/lib/outreach/discovery/githubSignal.ts`

**Interfaces:**
- Same shape as Tasks 4/5: `export async function findGithubCandidates(perDay, shouldStop)`, `export function githubQueriesForDay(now, perDay)`.

- [ ] **Step 1: Write the file**

```ts
import { politeFetchText } from './http';
import { findCandidates, type SourceSpec, type SearchCandidate } from './genericSource';

// Finds agencies via public GitHub repos/docs that integrate a voice-AI SDK
// (Vapi, Retell, Bland) in a business context, not a hobby/tutorial project —
// verify() additionally checks the linked site reads as a business rather
// than a personal GitHub Pages README.

export type { SearchCandidate };

const QUERIES = [
  'GitHub agency repo integrating Vapi voice AI SDK for clients',
  'GitHub agency repo integrating Retell AI voice agent for clients',
  'GitHub organization voice AI phone agent client integrations',
];

export function githubQueriesForDay(now = new Date(), perDay = 1): string[] {
  const dayNumber = Math.floor(now.getTime() / 86_400_000);
  return Array.from({ length: perDay }, (_, i) => QUERIES[(dayNumber + i) % QUERIES.length]);
}

const PROMPT = (query: string) => `Search the web for: ${query}

I want to find small/mid-size AGENCIES or dev studios (not individual hobbyists, not the voice-AI platforms themselves) with a public GitHub presence (an org account, a repo, or docs) showing they integrate a voice-AI SDK (Vapi, Retell, Bland) for their OWN CLIENTS as a service, not a personal side project.

Return ONLY a JSON array (at most 10 items) of objects with keys: name (the agency/org), website (their own business homepage URL, from the search results — not the raw GitHub repo URL itself unless it's genuinely their homepage), location (if shown, else null), blurb (one factual sentence about the integration work, from what you saw). Only include ones you actually saw in the search results. Use at most 4 web searches, then answer immediately. No commentary, no markdown fences.`;

const EXCLUDED_HOSTS = ['github.com', 'github.io', 'retellai.com', 'vapi.ai', 'bland.ai', 'npmjs.com', 'pypi.org'];

// Extra check beyond the shared voice-AI-keyword test: the site must not look
// like a bare personal GitHub Pages README (no real business content).
const LOOKS_LIKE_BUSINESS = /(about us|our clients|services|contact|team|case stud)/i;
const LOOKS_LIKE_VOICE_AI = /(voice|phone|call|receptionist|answering|ai agent|conversational)/i;

async function verifyIsAgencySite(domain: string): Promise<boolean> {
  const res = await politeFetchText(`https://${domain}`, 12000);
  if (!res.ok || res.text.length < 500) return false;
  const text = res.text.slice(0, 200_000);
  return LOOKS_LIKE_VOICE_AI.test(text) && LOOKS_LIKE_BUSINESS.test(text);
}

const SPEC: SourceSpec = {
  signalSource: 'search', // no dedicated DB value for github; reuses the generic 'search' category
  queriesForDay: githubQueriesForDay,
  promptFor: PROMPT,
  hostExclusions: EXCLUDED_HOSTS,
  verify: verifyIsAgencySite,
};

export async function findGithubCandidates(perDay: number, shouldStop: () => boolean = () => false) {
  return findCandidates(SPEC, perDay, shouldStop);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep githubSignal`
Expected: no output.

- [ ] **Step 3: Dry-run smoke test**

```ts
// /tmp/verify_github.ts
import { findGithubCandidates, githubQueriesForDay } from '/Users/sushanthtiruvaipati/Documents/github/calldesktech/src/lib/outreach/discovery/githubSignal';
(async () => {
  console.log('queries:', githubQueriesForDay(new Date(), 1));
  const { candidates, raw, rejected, errors } = await findGithubCandidates(1);
  console.log(`raw=${raw} verified=${candidates.length} rejected=${rejected.length} errors=${errors.length}`);
  console.log(candidates.slice(0, 3));
})();
```
Run: `npx tsx /tmp/verify_github.ts`
Expected: completes without throwing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/outreach/discovery/githubSignal.ts
git commit -m "Add GitHub/dev-signal discovery source

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Extend tech fingerprinting to competing platforms

**Files:**
- Modify: `src/lib/outreach/signals/techFingerprint.ts` (full file, ~54 lines today)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export async function checkDomainForPlatforms(domain: string): Promise<string[]>` — returns the names of every platform detected (e.g. `['Vapi', 'Retell']`), `[]` if none or fetch failed. The existing `checkDomainForRetell`/`findTechFingerprintSignals`/`TechFingerprintSignal` exports are kept unchanged (still used by the manual UI button) — this is additive, not a replacement.

- [ ] **Step 1: Add competitor markers and the new function**

Append to the existing file (keep everything already there, including `checkDomainForRetell` and `findTechFingerprintSignals`, exactly as-is):

```ts
// Competing-platform markers for the automated enrichment pass (pipeline.ts's
// stageEnrich): same technique as RETELL_MARKERS above (public script/asset
// signatures on the PROSPECT's own site), extended to the platforms Calldesk
// actually competes with. A hit here is strong scoring evidence — it confirms
// the lead already resells/integrates a voice-AI platform, not just that their
// description mentions the category.
const COMPETITOR_MARKERS: Record<string, string[]> = {
  Retell: RETELL_MARKERS,
  Vapi: ['vapi.ai', 'vapi-web-sdk', '@vapi-ai'],
  Bland: ['bland.ai', 'bland-client'],
  Synthflow: ['synthflow.ai'],
  ElevenLabs: ['elevenlabs.io/convai', 'elevenlabs-convai'],
  PlayAI: ['play.ai', 'playht.com'],
};

// Checks one domain for ANY known platform marker, returning every platform
// name detected (usually 0 or 1, but a migration in progress could show 2).
// Best-effort: a fetch failure yields [], never throws.
export async function checkDomainForPlatforms(domain: string): Promise<string[]> {
  const url = domain.startsWith('http') ? domain : `https://${domain}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'calldesk-outreach-research/1.0' } });
    if (!res.ok) return [];
    const html = await res.text();
    const found: string[] = [];
    for (const [platform, markers] of Object.entries(COMPETITOR_MARKERS)) {
      if (markers.some((marker) => html.includes(marker))) found.push(platform);
    }
    return found;
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep techFingerprint`
Expected: no output.

- [ ] **Step 3: Verify against fixture HTML (no live fetch needed for this check)**

```ts
// /tmp/verify_fingerprint_patterns.ts
// Sanity-checks the marker strings themselves against known SDK snippets,
// without hitting the network (checkDomainForPlatforms itself is exercised
// live in Task 9's end-to-end run).
const VAPI_SNIPPET = '<script src="https://cdn.vapi.ai/vapi-web-sdk.js"></script>';
const RETELL_SNIPPET = '<script src="https://retellai.com/widget.js"></script>';
const CLEAN_SNIPPET = '<html><body>Just a regular business site, no voice AI here.</body></html>';

const markers = {
  Retell: ['retellai.com', 'retell-client-js-sdk', 'retell-web-client'],
  Vapi: ['vapi.ai', 'vapi-web-sdk', '@vapi-ai'],
};

function detect(html: string): string[] {
  const found: string[] = [];
  for (const [platform, list] of Object.entries(markers)) {
    if (list.some((m) => html.includes(m))) found.push(platform);
  }
  return found;
}

console.log('Vapi snippet ->', detect(VAPI_SNIPPET), '(expect ["Vapi"])');
console.log('Retell snippet ->', detect(RETELL_SNIPPET), '(expect ["Retell"])');
console.log('clean snippet ->', detect(CLEAN_SNIPPET), '(expect [])');
```
Run: `npx tsx /tmp/verify_fingerprint_patterns.ts`
Expected: exactly the three commented results.

- [ ] **Step 4: Commit**

```bash
git add src/lib/outreach/signals/techFingerprint.ts
git commit -m "techFingerprint: detect competing platforms (Vapi/Bland/Synthflow/ElevenLabs/PlayAI), not just Retell

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Wire everything into `pipeline.ts`

**Files:**
- Modify: `src/lib/outreach/discovery/pipeline.ts` (full file, ~411 lines today)

**Interfaces:**
- Consumes: `scoreLead(input, evidence) => { score, reasons }` (Task 2), `findJobPostingCandidates` (Task 4), `findReviewSiteCandidates` (Task 5), `findGithubCandidates` (Task 6), `checkDomainForPlatforms` (Task 7).
- Produces: `runDiscovery`'s `RunSummary` gains `jobPostingCandidates: number`, `reviewSiteCandidates: number`, `githubCandidates: number`, `techFingerprintHits: number` fields, consumed by nothing outside this plan yet (safe additive change — any caller destructuring `RunSummary` still works since these are new optional-in-practice fields on an object literal, not a breaking type change to something narrower).

This is the biggest task — do it in the sub-steps below, typechecking after each, rather than as one giant edit.

- [ ] **Step 1: Update imports and `LeadRow`/`RunSummary`**

At the top of `pipeline.ts`, change:
```ts
import { isBlockedDomain, isRegionBlocked, scoreLead } from './score';
```
to:
```ts
import { isBlockedDomain, isRegionBlocked, scoreLead, type ScoreEvidence } from './score';
import { findJobPostingCandidates } from './jobPostingsSearch';
import { findReviewSiteCandidates } from './reviewSitesSearch';
import { findGithubCandidates } from './githubSignal';
import { checkDomainForPlatforms } from '../signals/techFingerprint';
```

In the `LeadRow` interface, add:
```ts
  signals: { reasons: string[]; techPlatforms: string[] } | null;
```

In `RunSummary`, add after `searchCandidates: number;`:
```ts
  jobPostingCandidates: number;
  reviewSiteCandidates: number;
  githubCandidates: number;
  techFingerprintHits: number;
```
And in the `summary` object literal inside `runDiscovery`, add matching zero-initialized fields: `jobPostingCandidates: 0, reviewSiteCandidates: 0, githubCandidates: 0, techFingerprintHits: 0,`.

- [ ] **Step 2: Fix the two existing `scoreLead` call sites for the new return shape**

In `stageDirectory`, find:
```ts
    const score = scoreLead({ tier: p.tier, location: p.location, description: p.description });
```
Replace with:
```ts
    const { score, reasons } = scoreLead({ tier: p.tier, location: p.location, description: p.description });
```
Then everywhere that row/insert used the old `score` variable in this function (the `entries.push` object, the `update()` call, and the `insert()` call), also set `signals: { reasons, techPlatforms: [] }` alongside `score` (both places already have a `score,` key in an object literal — add `signals: { reasons, techPlatforms: [] },` right after it, in the `update()` and `insert()` calls; for the in-memory `entries.push`/dry-run `fake` object, add `signals: { reasons, techPlatforms: [] },` too so the type matches `LeadRow`).

In `stageSearch`, find:
```ts
    const score = scoreLead({ tier: null, location: c.location, description: c.blurb });
```
Replace with:
```ts
    const { score, reasons } = scoreLead({ tier: null, location: c.location, description: c.blurb }, { viaReviewSite: false });
```
(`viaReviewSite: false` here is explicit and correct — `stageSearch` is the pre-existing generic agency-search stage, not the new review-site stage.) Then add `signals: { reasons, techPlatforms: [] },` to the `base` object literal used by both the dry-run `fake` and the real `insert()` in this function (both currently spread `...base`, so adding it to `base` covers both).

- [ ] **Step 3: Typecheck after Steps 1-2**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep pipeline.ts`
Expected: no output (the two pre-existing call sites are now fixed; the new imports aren't used yet, which will cause "unused import" warnings — that's expected and resolved by Step 4).

- [ ] **Step 4: Add the three new discovery stages**

Add these three new functions right after the existing `stageSearch` function (same file, same style — closely mirror `stageSearch`'s body since the shape is identical: search, dedupe against `index`, score with evidence, insert):

```ts
// Job-postings signal: agencies publicly hiring for a voice-AI role. Off by
// default (OUTREACH_JOBPOSTINGS_QUERIES_PER_DAY=0) until manually enabled.
async function stageJobPostings(
  db: Db, summary: RunSummary, dryRun: boolean, index: LeadIndex<LeadRow>, stop: () => boolean,
): Promise<DirectoryEntry[]> {
  const perDay = Math.min(6, Math.max(0, Number(process.env.OUTREACH_JOBPOSTINGS_QUERIES_PER_DAY ?? 0)));
  if (!perDay) return [];

  const { candidates, errors, raw, rejected } = await findJobPostingCandidates(perDay, stop);
  summary.errors.push(...errors);
  summary.jobPostingCandidates = candidates.length;
  if (rejected.length) summary.errors.push(`[job_posting] rejected as non-media/non-voice-AI: ${rejected.slice(0, 5).join(', ')}`);
  void raw;

  const entries: DirectoryEntry[] = [];
  const now = new Date().toISOString();
  for (const c of candidates) {
    const sourceKey = `job_posting:${c.domain}`;
    if (index.find({ sourceKey, name: c.name, domain: c.domain })) continue;

    const blocked = isRegionBlocked(c.location, c.name) || isBlockedDomain(c.domain);
    const { score, reasons } = scoreLead({ tier: null, location: c.location, description: c.blurb }, { viaJobPosting: true });
    summary.leadsNew++;

    const base = {
      company_name: c.name, domain: c.domain, source_key: sourceKey, tier: null, location: c.location,
      description: c.blurb, score, region_blocked: blocked, signals: { reasons, techPlatforms: [] },
    };
    if (dryRun) {
      const fake = { id: `dry-${c.domain}`, status: 'new', contact_email: null, contact_status: 'unknown', enriched_at: null, ...base } as LeadRow;
      index.add(fake);
      entries.push({ slug: null, row: fake });
      continue;
    }
    const { data: inserted, error } = await db.from('calldesk_outreach_leads').insert({
      ...base, signal_source: 'job_posting', signal_detail: `Job posting: ${(c.blurb ?? '').slice(0, 200)}`, last_seen_at: now,
    }).select('*').single();
    if (error) {
      summary.leadsNew--;
      summary.errors.push(`insert ${c.name}: ${error.message}`);
    } else if (inserted) {
      index.add(inserted as LeadRow);
      entries.push({ slug: null, row: inserted as LeadRow });
    }
  }
  return entries;
}

// Review-site signal: agencies named in public G2/Capterra/Clutch reviews as
// voice-AI providers. See reviewSitesSearch.ts for the compliance note (this
// stage's candidate blurbs are always generic labels, never review text).
async function stageReviewSites(
  db: Db, summary: RunSummary, dryRun: boolean, index: LeadIndex<LeadRow>, stop: () => boolean,
): Promise<DirectoryEntry[]> {
  const perDay = Math.min(6, Math.max(0, Number(process.env.OUTREACH_REVIEWSITES_QUERIES_PER_DAY ?? 0)));
  if (!perDay) return [];

  const { candidates, errors, raw, rejected } = await findReviewSiteCandidates(perDay, stop);
  summary.errors.push(...errors);
  summary.reviewSiteCandidates = candidates.length;
  if (rejected.length) summary.errors.push(`[review_site] rejected: ${rejected.slice(0, 5).join(', ')}`);
  void raw;

  const entries: DirectoryEntry[] = [];
  const now = new Date().toISOString();
  for (const c of candidates) {
    const sourceKey = `review_site:${c.domain}`;
    if (index.find({ sourceKey, name: c.name, domain: c.domain })) continue;

    const blocked = isRegionBlocked(c.location, c.name) || isBlockedDomain(c.domain);
    const { score, reasons } = scoreLead({ tier: null, location: c.location, description: c.blurb }, { viaReviewSite: true });
    summary.leadsNew++;

    const base = {
      company_name: c.name, domain: c.domain, source_key: sourceKey, tier: null, location: c.location,
      description: c.blurb, score, region_blocked: blocked, signals: { reasons, techPlatforms: [] },
    };
    if (dryRun) {
      const fake = { id: `dry-${c.domain}`, status: 'new', contact_email: null, contact_status: 'unknown', enriched_at: null, ...base } as LeadRow;
      index.add(fake);
      entries.push({ slug: null, row: fake });
      continue;
    }
    const { data: inserted, error } = await db.from('calldesk_outreach_leads').insert({
      ...base, signal_source: 'review_site', signal_detail: (c.blurb ?? 'Named in a public review as a voice-AI provider').slice(0, 200), last_seen_at: now,
    }).select('*').single();
    if (error) {
      summary.leadsNew--;
      summary.errors.push(`insert ${c.name}: ${error.message}`);
    } else if (inserted) {
      index.add(inserted as LeadRow);
      entries.push({ slug: null, row: inserted as LeadRow });
    }
  }
  return entries;
}

// GitHub/dev signal: agencies with a public GitHub presence integrating a
// voice-AI SDK for clients. Reuses signal_source='search' (no dedicated DB
// value; see githubSignal.ts).
async function stageGithub(
  db: Db, summary: RunSummary, dryRun: boolean, index: LeadIndex<LeadRow>, stop: () => boolean,
): Promise<DirectoryEntry[]> {
  const perDay = Math.min(6, Math.max(0, Number(process.env.OUTREACH_GITHUB_QUERIES_PER_DAY ?? 0)));
  if (!perDay) return [];

  const { candidates, errors, raw, rejected } = await findGithubCandidates(perDay, stop);
  summary.errors.push(...errors);
  summary.githubCandidates = candidates.length;
  if (rejected.length) summary.errors.push(`[github] rejected: ${rejected.slice(0, 5).join(', ')}`);
  void raw;

  const entries: DirectoryEntry[] = [];
  const now = new Date().toISOString();
  for (const c of candidates) {
    const sourceKey = `github:${c.domain}`;
    if (index.find({ sourceKey, name: c.name, domain: c.domain })) continue;

    const blocked = isRegionBlocked(c.location, c.name) || isBlockedDomain(c.domain);
    const { score, reasons } = scoreLead({ tier: null, location: c.location, description: c.blurb });
    summary.leadsNew++;

    const base = {
      company_name: c.name, domain: c.domain, source_key: sourceKey, tier: null, location: c.location,
      description: c.blurb, score, region_blocked: blocked, signals: { reasons, techPlatforms: [] },
    };
    if (dryRun) {
      const fake = { id: `dry-${c.domain}`, status: 'new', contact_email: null, contact_status: 'unknown', enriched_at: null, ...base } as LeadRow;
      index.add(fake);
      entries.push({ slug: null, row: fake });
      continue;
    }
    const { data: inserted, error } = await db.from('calldesk_outreach_leads').insert({
      ...base, signal_source: 'search', signal_detail: `GitHub/dev signal: ${(c.blurb ?? '').slice(0, 190)}`, last_seen_at: now,
    }).select('*').single();
    if (error) {
      summary.leadsNew--;
      summary.errors.push(`insert ${c.name}: ${error.message}`);
    } else if (inserted) {
      index.add(inserted as LeadRow);
      entries.push({ slug: null, row: inserted as LeadRow });
    }
  }
  return entries;
}
```

- [ ] **Step 5: Call the three new stages from `runDiscovery`**

Find:
```ts
    const { entries, index } = await stageDirectory(db, summary, dryRun);
    const searchEntries = stop() ? [] : await stageSearch(db, summary, dryRun, index, stop);
    if (!stop()) await stageEnrich(db, summary, dryRun, enrichLimit, [...entries, ...searchEntries], index, stop);
```
Replace with:
```ts
    const { entries, index } = await stageDirectory(db, summary, dryRun);
    const searchEntries = stop() ? [] : await stageSearch(db, summary, dryRun, index, stop);
    const jobPostingEntries = stop() ? [] : await stageJobPostings(db, summary, dryRun, index, stop);
    const reviewSiteEntries = stop() ? [] : await stageReviewSites(db, summary, dryRun, index, stop);
    const githubEntries = stop() ? [] : await stageGithub(db, summary, dryRun, index, stop);
    const allEntries = [...entries, ...searchEntries, ...jobPostingEntries, ...reviewSiteEntries, ...githubEntries];
    if (!stop()) await stageEnrich(db, summary, dryRun, enrichLimit, allEntries, index, stop);
```

- [ ] **Step 6: Automate tech fingerprinting inside `stageEnrich`**

Find, inside `stageEnrich`, right after the contact lookup:
```ts
      const contact = await findContact(domain);
      if (contact.status === 'found') summary.contactsFound++;
      summary.sample.enriched.push({ name: lead.company_name, domain, email: contact.email, status: contact.status });

      if (dryRun) continue;
```
Replace with:
```ts
      const contact = await findContact(domain);
      if (contact.status === 'found') summary.contactsFound++;
      summary.sample.enriched.push({ name: lead.company_name, domain, email: contact.email, status: contact.status });

      const techPlatforms = await checkDomainForPlatforms(domain);
      if (techPlatforms.length) summary.techFingerprintHits++;
      const evidence: ScoreEvidence = { techPlatforms };
      const { score: rescored, reasons } = scoreLead({ tier: lead.tier, location: lead.location, description: lead.description }, evidence);

      if (dryRun) continue;
```
Then find, a few lines below, the `db.from('calldesk_outreach_leads').update({...}).eq('id', lead.id);` call inside `stageEnrich` (the one setting `domain, contact_email, contact_status, contact_source_url, enriched_at`) and add `score: rescored, signals: { reasons, techPlatforms },` to that update's object literal, so the final code reads:
```ts
      const { error } = await db.from('calldesk_outreach_leads').update({
        domain,
        contact_email: contact.email,
        contact_status: contact.status,
        contact_source_url: contact.sourceUrl,
        enriched_at: now,
        score: rescored,
        signals: { reasons, techPlatforms },
        ...(suppressed ? { status: 'dead' } : {}),
      }).eq('id', lead.id);
```

- [ ] **Step 7: Full typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1`
Expected: zero errors across the whole repo. Fix anything that surfaces (most likely: a leftover unused-variable warning, or a missed `signals`/`score` field on one of the object literals touched above) before moving on.

- [ ] **Step 8: End-to-end dry-run verification**

```bash
set -a && . /Users/sushanthtiruvaipati/Documents/github/calldesktech/.env >/dev/null 2>&1; set +a
cd /Users/sushanthtiruvaipati/Documents/github/calldesktech
cat > /tmp/verify_pipeline_wiring.ts <<'EOF'
import { getSupabaseAdmin } from './src/lib/supabase';
import { runDiscovery } from './src/lib/outreach/discovery/pipeline';
process.env.OUTREACH_JOBPOSTINGS_QUERIES_PER_DAY = '1';
process.env.OUTREACH_REVIEWSITES_QUERIES_PER_DAY = '1';
process.env.OUTREACH_GITHUB_QUERIES_PER_DAY = '1';
process.env.OUTREACH_SEARCH_QUERIES_PER_DAY = '0'; // isolate the new stages from the existing one for this check
(async () => {
  const summary = await runDiscovery(getSupabaseAdmin(), { dryRun: true, enrichLimit: 3 });
  console.log(JSON.stringify({
    jobPostingCandidates: summary.jobPostingCandidates,
    reviewSiteCandidates: summary.reviewSiteCandidates,
    githubCandidates: summary.githubCandidates,
    techFingerprintHits: summary.techFingerprintHits,
    errors: summary.errors,
  }, null, 1));
})();
EOF
npx tsx /tmp/verify_pipeline_wiring.ts
```
Expected: runs to completion (dry run makes no writes), prints a JSON summary with `jobPostingCandidates`/`reviewSiteCandidates`/`githubCandidates` each >= 0 and no unexpected errors (a handful of "rejected as non-media" entries in `errors` is normal and expected).

- [ ] **Step 9: Commit**

```bash
git add src/lib/outreach/discovery/pipeline.ts
git commit -m "pipeline.ts: wire job-postings/review-sites/GitHub stages + automated tech-fingerprint rescoring

New stages default OFF (per-source *_QUERIES_PER_DAY env vars default to 0)
until manually enabled after reviewing a dry-run batch. Tech fingerprinting
now runs automatically inside stageEnrich instead of only via the manual
UI button, and rescores the lead with the detected-platform evidence.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Admin UI — show score + reasons

**Files:**
- Modify: `src/app/admin/outreach/page.tsx`

**Interfaces:**
- Consumes: `score: number | null` and `signals: { reasons: string[]; techPlatforms: string[] } | null` fields already present on every row returned by `GET /api/admin/outreach/leads` (that route does `select('*')`, so no API change is needed — only the `Lead` interface and the table markup need updating).

- [ ] **Step 1: Update the `Lead` interface**

Find:
```ts
interface Lead {
  id: string;
  company_name: string;
  domain: string | null;
  signal_source: string;
  signal_detail: string | null;
  status: string;
  created_at: string;
}
```
Replace with:
```ts
interface Lead {
  id: string;
  company_name: string;
  domain: string | null;
  signal_source: string;
  signal_detail: string | null;
  status: string;
  created_at: string;
  score: number | null;
  signals: { reasons: string[]; techPlatforms: string[] } | null;
}
```

- [ ] **Step 2: Add a Score column to the table**

Find the table header:
```tsx
            <tr>
              <th className="px-4 py-2.5">Company</th>
              <th className="px-4 py-2.5">Signal</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
```
Replace with:
```tsx
            <tr>
              <th className="px-4 py-2.5">Company</th>
              <th className="px-4 py-2.5">Signal</th>
              <th className="px-4 py-2.5">Score</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
```
Update the two `colSpan={4}` loading/empty rows to `colSpan={5}`.

Find the row markup:
```tsx
                <td className="px-4 py-2.5 text-gray-500">
                  {lead.signal_source}
                  {lead.signal_detail && <p className="text-[12px] text-gray-400">{lead.signal_detail}</p>}
                </td>
                <td className="px-4 py-2.5">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11.5px] font-medium text-gray-600">
                    {lead.status}
                  </span>
                </td>
```
Replace with:
```tsx
                <td className="px-4 py-2.5 text-gray-500">
                  {lead.signal_source}
                  {lead.signal_detail && <p className="text-[12px] text-gray-400">{lead.signal_detail}</p>}
                </td>
                <td className="px-4 py-2.5">
                  {lead.score != null ? (
                    <span title={lead.signals?.reasons?.join('\n') ?? ''} className="cursor-help font-medium">
                      {lead.score}
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                  {lead.signals?.techPlatforms?.length ? (
                    <p className="text-[11px] text-gray-400">{lead.signals.techPlatforms.join(', ')}</p>
                  ) : null}
                </td>
                <td className="px-4 py-2.5">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11.5px] font-medium text-gray-600">
                    {lead.status}
                  </span>
                </td>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "admin/outreach/page.tsx"`
Expected: no output.

- [ ] **Step 4: Manual visual check**

```bash
cd /Users/sushanthtiruvaipati/Documents/github/calldesktech && npm run build 2>&1 | tail -20
```
Expected: build succeeds with no type/lint errors on this route.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/outreach/page.tsx
git commit -m "Admin outreach lead list: show score and hover reasons, plus detected competing platforms

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Push, deploy, and enable one source at low volume

**Files:** none (operational task).

- [ ] **Step 1: Push**

```bash
cd /Users/sushanthtiruvaipati/Documents/github/calldesktech
git fetch -q origin
echo "commits ahead of origin/main (should be exactly this plan's commits):"
git log --oneline origin/main..HEAD
git push origin main
```
Expected: the pushed log shows only the 9 commits from Tasks 1-9 above (verify before pushing — if anything else is mixed in from a concurrent session, stop and flag it rather than push).

- [ ] **Step 2: Deploy**

```bash
flyctl deploy -a calldesk-tech 2>&1 | grep -E "Visit|error"
```
Expected: `Visit your newly deployed app at https://calldesk-tech.fly.dev/` with no `error` line.

- [ ] **Step 3: Enable job postings at low volume on the Mac mini harness**

```bash
ssh -o BatchMode=yes mac-mini 'grep -q OUTREACH_JOBPOSTINGS_QUERIES_PER_DAY ~/.calldesk-outreach/env || echo "OUTREACH_JOBPOSTINGS_QUERIES_PER_DAY=2" >> ~/.calldesk-outreach/env'
```
Leave `OUTREACH_REVIEWSITES_QUERIES_PER_DAY` and `OUTREACH_GITHUB_QUERIES_PER_DAY` at their default-0 (unset) for now — enable them the same way, one at a time, after reviewing job-postings' first batch of drafts in the queue.

- [ ] **Step 4: Kick one real run and read its output**

```bash
ssh -o BatchMode=yes mac-mini 'U=$(id -u); rm -f ~/.calldesk-outreach/logs/run_*.log; launchctl kickstart -k gui/$U/com.calldesk.outreach-discovery'
```
Wait a few minutes, then:
```bash
ssh -o BatchMode=yes mac-mini 'L=$(ls -t ~/.calldesk-outreach/logs/run_*.log | head -1); cat "$L"'
```
Expected: a summary JSON showing `jobPostingCandidates > 0` (or 0 if nothing matched today's query rotation — not itself a failure) and no unexpected errors. Read any drafts it produced in `https://calldesk-tech.fly.dev/admin/outreach/queue` before approving/sending any of them.
