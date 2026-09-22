import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { getSupabaseAdmin } from '@/lib/supabase';
import { runDiscovery } from '@/lib/outreach/discovery/pipeline';
import { resolveProduct } from '@/lib/outreach/products';

// One bounded discovery pass, invoked repeatedly through the day by launchd
// (run_cycle.sh) so contact collection runs continuously rather than once/day.
// Guard rails, all enforced here rather than trusted to config:
//   STOP file       -> run nothing (touch ~/.calldesk-outreach/STOP, or the product's
//                      state dir equivalent, to halt everything for that product)
//   min gap         -> refuses a second real run within OUTREACH_MIN_GAP_MINUTES of the
//                      last one (default 60; FORCE=1 overrides) -- a TIMESTAMP gap, not a
//                      calendar-date check, so multiple runs/day are the normal case.
//   hard ceilings   -> enrichment <= 30, research <= 8, drafts <= 10 per run, whatever the env says
//   soft deadline   -> winds down cleanly after 40 minutes
//   disk floor      -> skips if the machine has under 400 MB free
// It only reads public pages and writes leads/drafts. It has no send path --
// sending stays manual-approval-gated and capped regardless of how often this runs.
//
// PRODUCT selects which product's discovery config runs (default 'calldesk',
// unchanged from before this harness supported more than one product). Each
// product gets its own local state dir so run history/locks/limits never
// collide between products running independently (e.g. via cron/launchd
// invocations with different PRODUCT values).

const product = resolveProduct(process.env.PRODUCT);
const BASE = join(homedir(), product.stateDirName);
const STOP = join(BASE, 'STOP');
const LAST = join(BASE, 'last_run_at');
const RUNS = join(BASE, 'runs.jsonl');
const DEADLINE_MS = 40 * 60_000;
const MIN_FREE_MB = 400;
const MIN_GAP_MS = Math.max(15, Number(process.env.OUTREACH_MIN_GAP_MINUTES) || 60) * 60_000;

const clamp = (v: unknown, max: number, fallback: number) => {
  const n = Number(v);
  return Math.min(max, Math.max(0, Number.isFinite(n) ? Math.floor(n) : fallback));
};

function freeMb(): number {
  try {
    const kb = Number(execSync("df -k / | awk 'NR==2 {print $4}'").toString().trim());
    return Math.floor(kb / 1024);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

async function main(): Promise<number> {
  mkdirSync(BASE, { recursive: true });
  const stamp = new Date().toISOString();
  const now = Date.now();
  const dryRun = process.env.DRY_RUN === '1';

  if (existsSync(STOP)) {
    console.log(`[${stamp}] STOP file present, not running`);
    return 0;
  }
  const free = freeMb();
  if (free < MIN_FREE_MB) {
    console.error(`[${stamp}] only ${free} MB free (< ${MIN_FREE_MB}), skipping run`);
    return 2;
  }
  if (!dryRun && process.env.FORCE !== '1' && existsSync(LAST)) {
    const lastAt = Number(readFileSync(LAST, 'utf8').trim());
    if (Number.isFinite(lastAt) && now - lastAt < MIN_GAP_MS) {
      const waitMin = Math.ceil((MIN_GAP_MS - (now - lastAt)) / 60_000);
      console.log(`[${stamp}] ran ${Math.round((now - lastAt) / 60_000)}m ago, waiting ${waitMin}m more (FORCE=1 to override)`);
      return 0;
    }
  }
  if (!dryRun) writeFileSync(LAST, String(now));

  const startedAt = Date.now();
  const summary = await runDiscovery(getSupabaseAdmin(), {
    dryRun,
    enrichLimit: clamp(process.env.OUTREACH_ENRICH_LIMIT, 30, 15),
    draftLimit: clamp(process.env.OUTREACH_DRAFT_LIMIT, 10, 5),
    researchLimit: clamp(process.env.OUTREACH_RESEARCH_LIMIT, 8, 5),
    shouldStop: () => existsSync(STOP) || Date.now() - startedAt > DEADLINE_MS,
    product,
  });

  const line = { at: stamp, seconds: Math.round((Date.now() - startedAt) / 1000), ...summary, sample: undefined };
  appendFileSync(RUNS, JSON.stringify(line) + '\n');
  console.log(JSON.stringify(summary, null, 1));
  return summary.status === 'ok' ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error('harness crashed:', error);
  process.exit(1);
});
