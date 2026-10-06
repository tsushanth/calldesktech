#!/usr/bin/env -S node --import tsx
// Works through a backlog of leads that were found and have a contact email but were never researched or drafted,
// because the daily run only researches 8 and drafts 10 per pass. Same research and draft code as the daily run
// (researchAgency, stageDraft); this only lifts the per-run cap and shards the work across processes.
//
// researchAgency shells out to the `claude` CLI synchronously, so run SEVERAL processes with different SHARDs:
//
//   PRODUCT=calldesk SHARD=0/4 LIMIT=90 PHASE=research tsx harness/outreach/research-backlog.ts
//   PRODUCT=calldesk PHASE=draft LIMIT=400 tsx harness/outreach/research-backlog.ts      # once research is done
//
// Never sends anything: drafts land in the review queue exactly as the daily run's do.
// Stops when nothing is left, after LIMIT leads, or when ~/.calldesk-backlog/STOP exists.
// SOURCES (optional, comma list of signal_source) narrows the backlog, e.g. SOURCES=search,manual,review_site.
import fs from 'node:fs';
import os from 'node:os';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveProduct, leadsTable, scopeToProduct } from '@/lib/outreach/products';
import { researchAgency } from '@/lib/outreach/research';
import { stageDraft } from '@/lib/outreach/discovery/pipeline';

const STOP = `${os.homedir()}/.calldesk-backlog/STOP`;
const product = resolveProduct(process.env.PRODUCT);
const [shardIdx, shardCount] = (process.env.SHARD || '0/1').split('/').map(Number);
const LIMIT = Math.max(1, Number(process.env.LIMIT) || 100);
const PHASE = process.env.PHASE || 'research';
const SOURCES = (process.env.SOURCES || '').split(',').map((s) => s.trim()).filter(Boolean);
const MIN_SCORE = 40; // same floor as the daily run (MIN_DRAFT_SCORE)

const stopped = () => fs.existsSync(STOP);
const inShard = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % shardCount === shardIdx;
};

async function research() {
  const db = getSupabaseAdmin();
  let q = scopeToProduct(
    db.from(leadsTable(product)).select('*')
      .eq('status', 'new').eq('contact_status', 'found').eq('region_blocked', false)
      .is('researched_at', null).not('domain', 'is', null).gte('score', MIN_SCORE),
    product,
  );
  if (SOURCES.length) q = q.in('signal_source', SOURCES);
  const { data, error } = await q.order('score', { ascending: false }).limit(2000);
  if (error) throw new Error(error.message);
  const mine = ((data ?? []) as { id: string; company_name: string; domain: string; description: string | null; signals: { callRegion?: { verdict?: string } } | null }[]).filter((l) => inShard(l.id)).slice(0, LIMIT);
  console.log(`shard ${shardIdx}/${shardCount}: ${mine.length} leads to research`);
  let done = 0, low = 0, failed = 0;
  for (const lead of mine) {
    if (stopped()) { console.log('STOP file present, ending'); break; }
    try {
      const dossier = researchAgency({ name: lead.company_name, domain: lead.domain, description: lead.description });
      // A lead with a callable US/Canada phone (website region check) stays alive when the email pitch judges it
      // low fit: 'low' keeps it out of drafting, but status 'dead' would also drop it from the cold callers' batches.
      const callable = ['us_confirmed', 'us_likely', 'ca_confirmed', 'ca_likely'].includes(lead.signals?.callRegion?.verdict ?? '');
      const kill = dossier.fit === 'low' && !callable;
      const { error: e } = await db.from(leadsTable(product)).update({
        research: dossier, researched_at: new Date().toISOString(), fit: dossier.fit,
        ...(kill ? { status: 'dead', signal_detail: `Low fit: ${dossier.fit_reason}`.slice(0, 300) } : {}),
      }).eq('id', lead.id);
      if (e) { failed++; console.log(`store failed ${lead.company_name}: ${e.message}`); continue; }
      done++; if (dossier.fit === 'low') low++;
      console.log(`${done}/${mine.length} ${lead.company_name}: fit ${dossier.fit}`);
    } catch (err) {
      failed++; console.log(`research failed ${lead.company_name}: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`);
    }
  }
  console.log(`shard ${shardIdx}: researched ${done}, low fit ${low}, failed ${failed}`);
}

async function draft() {
  const db = getSupabaseAdmin();
  const summary = {
    runId: null, dryRun: false, status: 'ok', directoryCount: 0, searchCandidates: 0,
    jobPostingCandidates: 0, reviewSiteCandidates: 0, githubCandidates: 0, techFingerprintHits: 0,
    searchDebug: null, stopped: false, leadsSeen: 0, leadsNew: 0,
    duplicatesSkipped: 0, contactsFound: 0, draftsCreated: 0, followUpsCreated: 0, phoneBackfilled: 0, researched: 0, lowFit: 0, errors: [] as string[], sample: { enriched: [], researched: [] },
  };
  // researchOn = true: only researched, non-low-fit leads get drafted, as in the daily run.
  await stageDraft(db, summary as never, false, LIMIT, stopped, true, product);
  console.log(`drafted ${summary.draftsCreated}; errors ${summary.errors.length}`);
  for (const e of summary.errors.slice(0, 10)) console.log('  ' + e);
}

(PHASE === 'draft' ? draft() : research()).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
