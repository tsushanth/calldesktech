#!/usr/bin/env -S node --import tsx
// One-off: fill signals.registry.contactName for EXISTING freight leads from FMCSA's public census file
// (data.transportation.gov az4n-8mr2, columns company_officer_1 / company_officer_2). The name is for HUMAN callers to ask for
// ("Is William Walker available?") instead of pitching whoever picks up. It is never used in email drafts.
//
// Safe by construction: dry run unless LIVE=1; only leads keyed freight:mc:<MC> whose signals.registry.contactName is empty; each write
// re-asserts that in the PATCH filter and merges into the existing signals, so nothing else on the lead changes; idempotent.
//
//   tsx harness/outreach/backfill-freight-officers.ts           # dry run: reads, writes nothing
//   LIVE=1 tsx harness/outreach/backfill-freight-officers.ts    # write
import { getSupabaseAdmin } from '@/lib/supabase';
import { officerNameFromCensus, type CensusRow } from '@/lib/outreach/discovery/freightFmcsa';

const LIVE = process.env.LIVE === '1';
const MAX = Number(process.env.MAX) || Infinity; // stop after this many leads scanned (for a small preview)
const PRODUCT = 'calldesk:freight';
const CENSUS = 'https://data.transportation.gov/resource/az4n-8mr2.json';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dotOf = (signalDetail: string | null) => /\(DOT (\d+)\)/.exec(signalDetail ?? '')?.[1] ?? null;
const mask = (n: string) => `${n.split(' ')[0]} ${n.split(' ').slice(1).map((x) => x[0] + '.').join(' ')}`;

async function census(dots: string[]): Promise<Map<string, CensusRow>> {
  const out = new Map<string, CensusRow>();
  const url = `${CENSUS}?$select=dot_number,company_officer_1,company_officer_2&$limit=${dots.length + 50}&$where=${encodeURIComponent(`dot_number in(${dots.map((d) => `'${d}'`).join(',')})`)}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'calldesk-officer-backfill/1.0', ...(process.env.SOCRATA_APP_TOKEN ? { 'X-App-Token': process.env.SOCRATA_APP_TOKEN } : {}) } });
    if (res.status === 429) { await sleep(30_000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`census HTTP ${res.status}`);
    for (const r of (await res.json()) as CensusRow[]) if (r.dot_number) out.set(String(Number(r.dot_number)), r);
    return out;
  }
  throw new Error('census rate limited');
}

async function main() {
  const db = getSupabaseAdmin();
  const stats = { leads: 0, noDot: 0, alreadyHad: 0, notInCensus: 0, noUsableName: 0, wouldSet: 0, set: 0, raced: 0 };
  const samples: string[] = [];
  let lastId = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const { data, error } = await db.from('calldesk_outreach_leads').select('id, signal_detail, signals, source_key').eq('product', PRODUCT).like('source_key', 'freight:mc:%').gt('id', lastId).order('id').limit(250);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    lastId = data[data.length - 1].id as string;
    stats.leads += data.length;
    const todo = data.filter((l) => {
      const reg = ((l.signals as { registry?: { contactName?: string | null } } | null)?.registry) ?? {};
      if (reg.contactName) { stats.alreadyHad++; return false; }
      if (!dotOf(l.signal_detail as string | null)) { stats.noDot++; return false; }
      return true;
    });
    if (!todo.length) continue;
    const map = await census([...new Set(todo.map((l) => String(Number(dotOf(l.signal_detail as string)))))]);
    await sleep(3000);
    for (const l of todo) {
      const row = map.get(String(Number(dotOf(l.signal_detail as string))));
      if (!row) { stats.notInCensus++; continue; }
      const name = officerNameFromCensus(row);
      if (!name) { stats.noUsableName++; continue; }
      stats.wouldSet++;
      if (samples.length < 6) samples.push(mask(name));
      if (!LIVE) continue;
      const signals = (l.signals ?? {}) as Record<string, unknown>;
      const registry = { ...((signals.registry as Record<string, unknown> | undefined) ?? {}), contactName: name, contactNameSource: 'FMCSA census company officer' };
      const { data: upd, error: e } = await db.from('calldesk_outreach_leads').update({ signals: { ...signals, registry } }).eq('id', l.id as string).is('signals->registry->>contactName', null).select('id');
      if (e) throw new Error(e.message);
      if (upd?.length) stats.set++; else stats.raced++;
    }
    console.log(`${stats.leads} leads scanned, ${stats.wouldSet} names found`);
    if (stats.leads >= MAX) break;
  }
  console.log(`\n${LIVE ? 'LIVE' : 'DRY RUN'}`, JSON.stringify(stats), '\nmasked samples:', samples.join(' | '));
}
main().catch((e) => { console.error(e); process.exit(1); });
