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
// state we can read from its location or, failing that, from its +1 area code once its website check shows it serves the US or Canada (needed for calling hours), it is not marked dead/region-blocked,
// not flagged as a personal/home line by the registry loaders, not on the do-not-call list, and not already
// in an earlier batch. Products are taken in the order given, so freight fills a batch first and the next
// product tops it up. No lead is assigned to two callers the same day.

import { getSupabaseAdmin } from '@/lib/supabase';
import { normalizeNanp } from '@/lib/outboundCalling';
import { stateFromLocation, batchDateEastern, STATE_ZONES } from '@/lib/callingHours';
import { stateFromPhone } from '@/lib/areaCodeState';
import { selectRetries, dealWithQuotas, orderWithRetries, type PreviousRow } from '@/lib/batchPlanning';

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
// lead_id is nullable in the table (a retry's lead may since have been deleted), so fresh and retry rows share this shape.
type BatchEntry = { lead_id: string | null; phone: string; company_name: string; state: string | null; attempt: number; hourET: number | null | undefined };
type Candidate = { lead_id: string; phone: string; company_name: string; state: string; product: string };

async function main() {
  const db = getSupabaseAdmin();
  console.log(`Batch date ${DATE} | callers ${CALLERS.join(', ')} | ${PER} each | products ${PRODUCTS.join(' > ')} | states ${STATES.join(',') || 'all'} | ${COMMIT ? 'COMMIT' : 'dry run'}`);

  // PostgREST returns at most 1000 rows per request, so read the big tables page by page.
  async function readAll<R>(table: string, cols: string): Promise<R[]> {
    const out: R[] = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await db.from(table).select(cols).order('phone').range(off, off + 999);
      if (error) return out.length ? out : [];
      out.push(...((data ?? []) as unknown as R[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  }
  const dnc = new Set<string>((await readAll<{ phone: string }>('calldesk_do_not_call', 'phone')).map((r) => r.phone));
  // Carrier lookups (scripts/lookup-line-types.mjs): numbers the carrier says are not valid are never batched.
  const lookups = new Map<string, { line_type: string | null; valid: boolean | null }>(
    (await readAll<{ phone: string; line_type: string | null; valid: boolean | null }>('calldesk_phone_lookups', 'phone, line_type, valid')).map((r) => [r.phone, r]),
  );
  // Phones already given to a caller on an earlier day. (If migration 062 is not applied yet this is empty.)
  const prior = await db.from('calldesk_call_batches').select('phone').lt('batch_date', DATE);
  const used = new Set<string>(((prior.error ? [] : prior.data) ?? []).map((r: { phone: string }) => r.phone));
  if (prior.error) console.log(`(calldesk_call_batches not readable yet: ${prior.error.message}; treating as empty)`);

  // Retries: a number logged as "voicemail" on its first attempt comes back once, to the same caller, placed at a
  // different time of the shift. At most a quarter of a caller's batch, so fresh numbers are never crowded out.
  const weekAgo = new Date(`${DATE}T12:00:00Z`);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
  const prev = await db.from('calldesk_call_batches')
    .select('sip_username, phone, lead_id, company_name, state, attempt, outcome, batch_date')
    .lt('batch_date', DATE).gte('batch_date', weekAgo.toISOString().slice(0, 10)).order('batch_date', { ascending: false });
  const retriedBefore = await db.from('calldesk_call_batches').select('phone').eq('attempt', 2);
  const retries: PreviousRow[] = selectRetries((prev.error ? [] : (prev.data ?? [])) as PreviousRow[], {
    blocked: dnc,
    alreadyRetried: new Set<string>(((retriedBefore.error ? [] : retriedBefore.data) ?? []).map((r: { phone: string }) => r.phone)),
    maxPerCaller: Math.floor(PER * 0.25),
  }).filter((r) => CALLERS.includes(r.sip_username));
  if (retries.length) {
    // When each was first dialled (US Eastern hour), so the retry lands at a different time of day.
    const calls = await db.from('calldesk_outbound_calls').select('to_number, started_at').in('to_number', retries.map((r) => r.phone)).neq('status', 'rejected').order('started_at', { ascending: false });
    const hourOf = new Map<string, number>();
    for (const c of (calls.error ? [] : calls.data) ?? []) {
      if (hourOf.has(c.to_number)) continue;
      hourOf.set(c.to_number, Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(c.started_at))));
    }
    for (const r of retries) r.hourET = hourOf.get(r.phone) ?? null;
  }
  const quota: Record<string, number> = Object.fromEntries(CALLERS.map((c) => [c, PER - retries.filter((r) => r.sip_username === c).length]));
  const need = Object.values(quota).reduce((a, b) => a + b, 0);
  if (retries.length) console.log(`Retries coming back: ${retries.length} (${CALLERS.map((c) => `${c} ${retries.filter((r) => r.sip_username === c).length}`).join(', ')})`);
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
      // No state in the location (most web-search leads): read it from the area code, but only for a lead whose
      // own website check says it serves the US or Canada (signals.callRegion). Where the business is based does
      // not matter, only whether the number is a real +1 number: foreign mobiles stored without a country code
      // look like US numbers, and the check catches them by finding the same digits on the site under another code.
      const verdict = (l.signals as { callRegion?: { verdict?: string } } | null)?.callRegion?.verdict;
      const verified = verdict === 'us_confirmed' || verdict === 'us_likely' || verdict === 'ca_confirmed' || verdict === 'ca_likely';
      const state = stateFromLocation(l.location) ?? (verified ? stateFromPhone(l.phone) : null);
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

  // Deal from a list sorted by line type then state, so every caller gets (almost exactly) the same mix of line
  // types and states; a plain random split left one caller with 15 more mobile numbers. Callers who already have
  // retries get proportionally fewer fresh numbers. Each caller's order is shuffled, with retries moved to a
  // different time of the shift than their first try.
  const keyOf = (c: Candidate) => `${lookups.get(c.phone)?.line_type || 'zz'}|${c.state}`;
  const sorted = picked.slice().sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  const dealt = dealWithQuotas(sorted, CALLERS, quota);
  const rows = CALLERS.flatMap((u) => {
    const fresh: BatchEntry[] = shuffle(dealt[u], rng(`${DATE}:order:${u}`)).map((c) => ({
      lead_id: c.lead_id, phone: c.phone, company_name: c.company_name, state: c.state as string | null, attempt: 1, hourET: null as number | null | undefined,
    }));
    const back: BatchEntry[] = retries.filter((r) => r.sip_username === u).map((r) => ({
      lead_id: r.lead_id, phone: r.phone, company_name: r.company_name, state: r.state, attempt: 2, hourET: r.hourET,
    }));
    return orderWithRetries(fresh, back).map((x, idx) => ({
      batch_date: DATE, sip_username: u, lead_id: x.lead_id, phone: x.phone, company_name: x.company_name,
      state: x.state as string, position: idx + 1, attempt: x.attempt,
    }));
  });
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
