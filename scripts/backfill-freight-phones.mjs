// One-off: fill leads.phone for EXISTING freight leads that have none, from FMCSA's public authority
// dataset (data.transportation.gov 6eyk-hxee, column `bus_telno`, populated for ~97% of active US brokers).
//
// HUMAN CALLS ONLY. The phone goes into leads.phone, which only the human caller tooling reads
// (scripts/build-call-batch.ts, /caller, the softphone). No automated or AI-voice dialer may use it, and
// nothing here sends a text or places a call (internal-docs/legal/OUTBOUND-CONSENT-RESEARCH.md).
//
// Safe by construction:
//   * DRY RUN by default: reads FMCSA and reads the leads table, writes nothing. Pass --live to write.
//   * Idempotent: only leads whose phone IS NULL are touched, and each write re-asserts `phone IS NULL`
//     in the PATCH filter, so a re-run (or a concurrent writer) never overwrites an existing phone.
//   * Resumable: walks the authority file in docket_number order; a live run checkpoints the last docket
//     processed and continues from it next time. --restart ignores/clears the checkpoint, --from=MC012345
//     starts after a given docket.
//   * Batched and polite: FMCSA pages of PAGE rows with backoff on 429; lead lookups in chunks of 100;
//     live writes a few at a time with a short pause.
//   * US only: the FMCSA query is bus_ctry_code='US', and only leads keyed `freight:mc:<MC>` (the FMCSA
//     source) are considered, so non-US freight leads are never touched.
//   * Personal-line policy: a lead flagged signals.registry.callerPhoneExcluded, or whose name looks like
//     a person (sole proprietor), is skipped, same rule as the discovery loaders (callerPhonePolicy.ts).
//
// Run (needs tsx because it reuses the TypeScript phone and policy helpers; env as for the other scripts):
//   npx tsx --env-file=.env scripts/backfill-freight-phones.mjs                 # dry run
//   npx tsx --env-file=.env scripts/backfill-freight-phones.mjs --live          # write
//   flags: --limit=N (stop after N updates / would-updates)  --from=MC012345  --restart  --page=500
//
// Uses NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment. Never prints them,
// and never prints a full phone number (samples are masked).

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeFreightPhone } from '../src/lib/outreach/freight.ts';
import { callerPhoneExclusion } from '../src/lib/outreach/discovery/callerPhonePolicy.ts';

export { normalizeFreightPhone };

const FMCSA = 'https://data.transportation.gov/resource/6eyk-hxee.json';
const PRODUCT = 'calldesk:freight';
const STATE_FILE = process.env.FREIGHT_PHONE_STATE_FILE || join(tmpdir(), 'calldesk-freight-phone-backfill.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mask = (p) => (p ? `+1******${p.slice(-4)}` : null);

/** "MC012345" -> "12345" (same rule as freightFmcsa.mcNumber). */
export function mcOf(docket) {
  const m = /^MC0*(\d{3,8})$/i.exec(String(docket ?? '').trim());
  return m ? m[1] : null;
}

/**
 * Pure planning step, exported for tests. Given one FMCSA page and the matching lead rows (phone IS NULL),
 * returns what to write and why anything is skipped.
 */
export function planPage(authRows, leads) {
  const phoneByMc = new Map();
  let invalid = 0;
  for (const a of authRows) {
    const mc = mcOf(a.docket_number);
    if (!mc) continue;
    const phone = normalizeFreightPhone(a.bus_telno);
    if (!phone) { invalid++; continue; }
    phoneByMc.set(mc, phone);
  }
  const updates = [];
  const skipped = { excludedPersonal: 0, noMatch: 0, notFmcsaKey: 0 };
  for (const lead of leads) {
    const m = /^freight:mc:(\d+)$/i.exec(String(lead.source_key ?? ''));
    if (!m) { skipped.notFmcsaKey++; continue; }
    const phone = phoneByMc.get(m[1]);
    if (!phone) { skipped.noMatch++; continue; }
    if (lead.phone) continue; // idempotence: never overwrite
    if (lead.signals?.registry?.callerPhoneExcluded || callerPhoneExclusion({ name: lead.company_name ?? '' })) { skipped.excludedPersonal++; continue; }
    updates.push({ id: lead.id, mc: m[1], phone });
  }
  return { updates, invalid, skipped, withPhone: phoneByMc.size };
}

async function fmcsaPage(after, pageSize) {
  const where = [`broker_stat='A'`, `bus_ctry_code='US'`, `docket_number like 'MC%'`, `bus_telno IS NOT NULL`];
  if (after) where.push(`docket_number > '${after.replace(/[^A-Za-z0-9]/g, '')}'`);
  const qs = new URLSearchParams({ $select: 'docket_number,bus_telno', $where: where.join(' AND '), $order: 'docket_number', $limit: String(pageSize) });
  const headers = { Accept: 'application/json', 'User-Agent': 'calldesk-outreach-research/1.0 (+https://calldesk.tech)' };
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  let delay = 2000;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${FMCSA}?${qs}`, { headers });
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    if (res.status !== 429 && res.status < 500) throw new Error(`FMCSA HTTP ${res.status}`);
    await sleep(delay);
    delay *= 2;
  }
  throw new Error('FMCSA: gave up after retries');
}

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  return async (path, init = {}) => {
    const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    if (!r.ok) throw new Error(`supabase ${init.method || 'GET'} ${path.split('?')[0]}: ${r.status}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  };
}

function loadState() {
  try { return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : null; } catch { return null; }
}

export async function main(argv = process.argv.slice(2)) {
  const flag = (n) => argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  const val = (n) => flag(n)?.split('=')[1];
  const live = !!flag('live');
  const limit = Number(val('limit')) > 0 ? Number(val('limit')) : Infinity;
  const pageSize = Math.min(2000, Math.max(50, Number(val('page')) || 500));
  if (flag('restart') && existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  const state = flag('restart') ? null : loadState();
  let after = val('from') || (live ? state?.lastDocket : null) || null;

  const db = sb();
  console.log(`freight phone backfill: ${live ? 'LIVE (writing)' : 'DRY RUN (no writes)'}; resuming after ${after ?? 'the start'}; page ${pageSize}`);
  const totals = { pages: 0, fmcsaWithPhone: 0, leadsChecked: 0, updated: 0, wouldUpdate: 0, invalidPhones: 0, excludedPersonal: 0, failed: 0 };
  const samples = [];

  for (;;) {
    const rows = await fmcsaPage(after, pageSize);
    if (!rows.length) break;
    totals.pages++;
    totals.fmcsaWithPhone += rows.length;
    const mcs = [...new Set(rows.map((r) => mcOf(r.docket_number)).filter(Boolean))];
    const leads = [];
    for (let i = 0; i < mcs.length; i += 100) {
      const keys = mcs.slice(i, i + 100).map((m) => `freight:mc:${m}`).join(',');
      const got = await db(`calldesk_outreach_leads?select=id,source_key,phone,company_name,signals&product=eq.${encodeURIComponent(PRODUCT)}&phone=is.null&source_key=in.(${keys})`);
      leads.push(...got);
    }
    totals.leadsChecked += leads.length;
    const plan = planPage(rows, leads);
    totals.invalidPhones += plan.invalid;
    totals.excludedPersonal += plan.skipped.excludedPersonal;

    let todo = plan.updates;
    if (totals.updated + totals.wouldUpdate + todo.length > limit) todo = todo.slice(0, Math.max(0, limit - totals.updated - totals.wouldUpdate));
    if (!live) {
      totals.wouldUpdate += todo.length;
      for (const u of todo) if (samples.length < 5) samples.push(`MC-${u.mc} -> ${mask(u.phone)}`);
    } else {
      for (let i = 0; i < todo.length; i += 5) {
        await Promise.all(todo.slice(i, i + 5).map(async (u) => {
          try {
            // phone=is.null in the filter: a lead that got a phone meanwhile is left alone.
            await db(`calldesk_outreach_leads?id=eq.${u.id}&phone=is.null`, { method: 'PATCH', body: JSON.stringify({ phone: u.phone }), headers: { Prefer: 'return=minimal' } });
            totals.updated++;
          } catch (e) {
            totals.failed++;
            console.error(`  update failed for MC-${u.mc}: ${e instanceof Error ? e.message : e}`);
          }
        }));
        await sleep(150);
      }
    }

    after = rows[rows.length - 1].docket_number;
    // Checkpoint only after a page is fully processed (not when --limit cut it short), and only on a live run.
    if (live && totals.failed === 0 && todo.length === plan.updates.length) writeFileSync(STATE_FILE, JSON.stringify({ lastDocket: after, at: new Date().toISOString() }));
    console.log(`  page ${totals.pages}: through ${after}; ${plan.updates.length} to fill so far ${live ? totals.updated : totals.wouldUpdate}`);
    if (totals.updated + totals.wouldUpdate >= limit) break;
    if (rows.length < pageSize) break;
    await sleep(500);
  }

  if (live && totals.failed === 0 && existsSync(STATE_FILE) && !(totals.updated + totals.wouldUpdate >= limit)) unlinkSync(STATE_FILE); // finished: next run starts fresh
  console.log(JSON.stringify({ mode: live ? 'live' : 'dry-run', ...totals, sample: samples }, null, 1));
  return totals;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
