#!/usr/bin/env -S node --import tsx
// Finds reseller leads from Google results (incl. paid ads, via DataForSEO) and Vapi's partner directory, then finds contact
// details for them and for older agency leads that never got any. No LLM calls except what contact enrichment already does.
// Never sends or drafts anything.
//
//   OUTREACH_SERP_QUERIES_PER_DAY=40 OUTREACH_SERP_MAX=40 OUTREACH_VAPI_DIRECTORY=1 ENRICH=80 tsx harness/outreach/discover-resellers.ts
//   DRY_RUN=1 ...   # reads and verifies, writes nothing
import { getSupabaseAdmin } from '@/lib/supabase';
import { discoverResellers } from '@/lib/outreach/discovery/pipeline';

(async () => {
  const s = await discoverResellers(getSupabaseAdmin(), {
    enrichLimit: Number(process.env.ENRICH) || 60,
    dryRun: process.env.DRY_RUN === '1',
    deadlineSeconds: Number(process.env.DEADLINE_SECONDS) || 900,
  });
  console.log(JSON.stringify({
    serpCandidates: s.serpCandidates, vapiPartners: s.vapiPartners, leadsNew: s.leadsNew, contactsFound: s.contactsFound, stopped: s.stopped,
    errors: s.errors.slice(0, 10).map((e) => e.slice(0, 160)),
  }, null, 1));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
