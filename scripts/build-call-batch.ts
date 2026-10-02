#!/usr/bin/env -S npx tsx
// Builds one day's call batches for the hired cold callers: a fresh set of dialable numbers per caller,
// written to calldesk_call_batches. The sales line only dials numbers in a caller's batch for that day.
//
// Dry run by default (reads only). Writing needs COMMIT=1 and migration 062 applied.
//
//   npx tsx --env-file=.env scripts/build-call-batch.ts
//   DATE=2026-10-05 PER=100 CALLERS=mary,mark PRODUCTS=calldesk:freight,calldesk:insurance COMMIT=1 \
//     npx tsx --env-file=.env scripts/build-call-batch.ts
//
// A lead is eligible when: it has a valid US/Canada phone (any stored format, normalised to E.164), a US
// state we can read from its location (needed for calling hours), it is not marked dead/region-blocked,
// not flagged as a personal/home line by the registry loaders, not on the do-not-call list, and not already
// in an earlier batch. Products are taken in the order given, so freight fills a batch first and the next
// product tops it up. No lead is assigned to two callers the same day.

import { getSupabaseAdmin } from '@/lib/supabase';
import { normalizeNanp } from '@/lib/outboundCalling';
import { stateFromLocation, batchDateEastern, STATE_ZONES } from '@/lib/callingHours';

const CALLERS = (process.env.CALLERS || 'mary,mark').split(',').map((s) => s.trim()).filter(Boolean);
const PER = Math.max(1, Number(process.env.PER) || 100);
const PRODUCTS = (process.env.PRODUCTS || 'calldesk:freight,calldesk:insurance').split(',').map((s) => s.trim()).filter(Boolean);
const COMMIT = process.env.COMMIT === '1';
// Optional: only batch leads in these US states, e.g. STATES=TX (a one-state pilot).
const STATES = (process.env.STATES || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

function nextWeekdayEastern(): string {
  const d = new Date();
  for (let i = 0; i < 8; i++) {
    d.setUTCDate(d.getUTCDate() + (i === 0 ? 0 : 1));
    const date = batchDateEastern(d);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (i > 0 && dow !== 0 && dow !== 6) return date;
  }
  return batchDateEastern(d);
}
const DATE = process.env.DATE || nextWeekdayEastern();

// Deterministic shuffle so a re-run for the same date gives the same assignment.
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

type Lead = { id: string; company_name: string; phone: string; location: string | null; product: string; signals: Record<string, unknown> | null };
type Candidate = { lead_id: string; phone: string; company_name: string; state: string; product: string };

async function main() {
  const db = getSupabaseAdmin();
  console.log(`Batch date ${DATE} | callers ${CALLERS.join(', ')} | ${PER} each | products ${PRODUCTS.join(' > ')} | states ${STATES.join(',') || 'all'} | ${COMMIT ? 'COMMIT' : 'dry run'}`);

  const dnc = new Set<string>(((await db.from('calldesk_do_not_call').select('phone')).data ?? []).map((r: { phone: string }) => r.phone));
  // Carrier lookups (scripts/lookup-line-types.mjs): numbers the carrier says are not valid are never batched.
  const lk = await db.from('calldesk_phone_lookups').select('phone, line_type, valid');
  const lookups = new Map<string, { line_type: string | null; valid: boolean | null }>(
    ((lk.error ? [] : lk.data) ?? []).map((r: { phone: string; line_type: string | null; valid: boolean | null }) => [r.phone, r]),
  );
  // Phones already given to a caller on an earlier day. (If migration 062 is not applied yet this is empty.)
  const prior = await db.from('calldesk_call_batches').select('phone').lt('batch_date', DATE);
  const used = new Set<string>(((prior.error ? [] : prior.data) ?? []).map((r: { phone: string }) => r.phone));
  if (prior.error) console.log(`(calldesk_call_batches not readable yet: ${prior.error.message}; treating as empty)`);

  const need = PER * CALLERS.length;
  const picked: Candidate[] = [];
  const seen = new Set<string>();
  const perProduct: Record<string, { eligible: number; taken: number }> = {};

  for (const product of PRODUCTS) {
    if (picked.length >= need) break;
    const leads: Lead[] = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await db
        .from('calldesk_outreach_leads')
        .select('id, company_name, phone, location, product, signals')
        .eq('product', product).eq('region_blocked', false).neq('status', 'dead').not('phone', 'is', null)
        .order('id').range(off, off + 999);
      if (error) throw new Error(`${product}: ${error.message}`);
      leads.push(...((data ?? []) as Lead[]));
      if (!data || data.length < 1000) break;
    }
    const eligible: Candidate[] = [];
    for (const l of leads) {
      const phone = normalizeNanp(l.phone);
      const state = stateFromLocation(l.location);
      const excluded = (l.signals as { registry?: { callerPhoneExcluded?: string } } | null)?.registry?.callerPhoneExcluded;
      if (STATES.length && state && !STATES.includes(state)) continue;
      if (!phone || !state || excluded || dnc.has(phone) || used.has(phone) || seen.has(phone)) continue;
      if (lookups.get(phone)?.valid === false) continue;
      seen.add(phone);
      eligible.push({ lead_id: l.id, phone, company_name: l.company_name, state, product });
    }
    const take = shuffle(eligible, rng(`${DATE}:${product}`)).slice(0, need - picked.length);
    picked.push(...take);
    perProduct[product] = { eligible: eligible.length, taken: take.length };
  }

  console.log('\nEligible numbers by product:');
  for (const [p, v] of Object.entries(perProduct)) console.log(`  ${p.padEnd(24)} eligible ${String(v.eligible).padStart(5)} | used in this batch ${v.taken}`);
  console.log(`Total picked ${picked.length} of ${need} needed${picked.length < need ? '  <-- SHORT: add products or wait for more phones' : ''}`);

  // Deal alternately from a list sorted by line type then state, so every caller gets (almost exactly) the same
  // mix of line types and states; a plain random split left one caller with 15 more mobile numbers. The order
  // each caller then works in is shuffled again, so position carries no pattern.
  const keyOf = (c: Candidate) => `${lookups.get(c.phone)?.line_type || 'zz'}|${c.state}`;
  const sorted = picked.slice().sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  const dealt = sorted.map((c, i) => ({ c, caller: CALLERS[i % CALLERS.length] }));
  const rows = CALLERS.flatMap((u) =>
    shuffle(dealt.filter((d) => d.caller === u), rng(`${DATE}:order:${u}`)).map((d, idx) => ({
      batch_date: DATE, sip_username: u, lead_id: d.c.lead_id, phone: d.c.phone,
      company_name: d.c.company_name, state: d.c.state, position: idx + 1, attempt: 1,
    })),
  );
  for (const u of CALLERS) {
    const mine = rows.filter((r) => r.sip_username === u);
    const byState: Record<string, number> = {};
    for (const r of mine) byState[r.state] = (byState[r.state] || 0) + 1;
    const top = Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s, n]) => `${s} ${n}`).join(', ');
    const zones = new Set(mine.map((r) => STATE_ZONES[r.state][0]));
    const lt: Record<string, number> = {};
    for (const r of mine) { const k = lookups.get(r.phone)?.line_type || 'not looked up'; lt[k] = (lt[k] || 0) + 1; }
    console.log(`  ${u.padEnd(10)} line types: ${Object.entries(lt).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
    console.log(`  ${u.padEnd(10)} ${mine.length} numbers | top states: ${top} | ${zones.size} time zones`);
  }

  if (!COMMIT) { console.log('\nDry run only: nothing written. Re-run with COMMIT=1 to write.'); return; }
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from('calldesk_call_batches').upsert(rows.slice(i, i + 200), { onConflict: 'batch_date,sip_username,phone', ignoreDuplicates: true });
    if (error) throw new Error(`insert failed: ${error.message}`);
  }
  console.log(`\nWrote ${rows.length} rows to calldesk_call_batches for ${DATE}.`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
