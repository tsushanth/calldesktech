import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { getSupabaseAdmin } from '@/lib/supabase';
import { runDiscovery } from '@/lib/outreach/discovery/pipeline';

// One bounded discovery pass, invoked once a day by launchd (run_cycle.sh).
// Guard rails, all enforced here rather than trusted to config:
//   STOP file       -> run nothing (touch ~/.calldesk-outreach/STOP to halt everything)
//   once per day    -> refuses a second real run on the same local date (FORCE=1 overrides)
//   hard ceilings   -> enrichment <= 30, drafts <= 10 per run, whatever the env says
//   soft deadline   -> winds down cleanly after 25 minutes
//   disk floor      -> skips if the machine has under 400 MB free
// It only reads public pages and writes leads/drafts. It has no send path.

const BASE = join(homedir(), '.calldesk-outreach');
const STOP = join(BASE, 'STOP');
const LAST = join(BASE, 'last_run_date');
const RUNS = join(BASE, 'runs.jsonl');
const DEADLINE_MS = 25 * 60_000;
const MIN_FREE_MB = 400;

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
  const today = new Date().toLocaleDateString('en-CA');
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
  if (!dryRun && process.env.FORCE !== '1' && existsSync(LAST) && readFileSync(LAST, 'utf8').trim() === today) {
    console.log(`[${stamp}] already ran today (${today}), skipping (FORCE=1 to override)`);
    return 0;
  }
  if (!dryRun) writeFileSync(LAST, today);

  const startedAt = Date.now();
  const summary = await runDiscovery(getSupabaseAdmin(), {
    dryRun,
    enrichLimit: clamp(process.env.OUTREACH_ENRICH_LIMIT, 30, 15),
    draftLimit: clamp(process.env.OUTREACH_DRAFT_LIMIT, 10, 5),
    shouldStop: () => existsSync(STOP) || Date.now() - startedAt > DEADLINE_MS,
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
