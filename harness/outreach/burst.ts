import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getSupabaseAdmin } from '@/lib/supabase';
import { runDiscovery } from '@/lib/outreach/discovery/pipeline';
import { resolveProduct } from '@/lib/outreach/products';

// One-off backlog burst for a product's discovery pipeline, with stage limits above the daily harness'
// per-run clamps (run.ts: enrich <= 30, research <= 8, drafts <= 10). Same runDiscovery as the daily run
// and the same guard rails that matter here: the product's STOP file halts it, and it has no send path
// (drafts still need approval). Use it to work a freshly imported lead list through enrichment, research
// and drafting in one sitting instead of over weeks.
//
//   PRODUCT=readaloud ENRICH=400 RESEARCH=60 DRAFT=40 DEADLINE_MIN=120 tsx harness/outreach/burst.ts
//   DRY_RUN=1 ...                                   # counts only
const product = resolveProduct(process.env.PRODUCT);
const STOP = join(homedir(), product.stateDirName, 'STOP');
const num = (v: string | undefined, fallback: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback; };

async function main() {
  if (existsSync(STOP)) { console.log('STOP file present, not running'); return 0; }
  const deadlineMs = num(process.env.DEADLINE_MIN, 90) * 60_000;
  const startedAt = Date.now();
  const summary = await runDiscovery(getSupabaseAdmin(), {
    dryRun: process.env.DRY_RUN === '1',
    enrichLimit: num(process.env.ENRICH, 200),
    researchLimit: num(process.env.RESEARCH, 40),
    draftLimit: num(process.env.DRAFT, 30),
    deadlineMs,
    shouldStop: () => existsSync(STOP) || Date.now() - startedAt > deadlineMs,
    product,
  });
  console.log(JSON.stringify({ ...summary, sample: undefined, seconds: Math.round((Date.now() - startedAt) / 1000) }, null, 1));
  return summary.status === 'ok' ? 0 : 1;
}
main().then((c) => process.exit(c)).catch((e) => { console.error('burst crashed:', e); process.exit(1); });
