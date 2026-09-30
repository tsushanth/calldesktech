#!/usr/bin/env -S node --import tsx
// Backtest of the mailbox verifier against KNOWN outcomes: every address that previously hard-bounced
// (should be flagged) plus a random sample of addresses that delivered fine (should pass). Read-only:
// it never writes to the database. Uses up to LIMIT credits (default 100 = a free tier).
//
//   tsx harness/outreach/verify-backtest.ts                      # no key: prints the selection only
//   EMAIL_VERIFY_API_KEY=... tsx harness/outreach/verify-backtest.ts
//   EMAIL_VERIFY_PROVIDER=zerobounce LIMIT=5 POS_ONLY=1 EMAIL_VERIFY_API_KEY=... tsx harness/outreach/verify-backtest.ts
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyMailbox, type Verdict } from '@/lib/outreach/emailVerify';

const LIMIT = Math.max(1, Number(process.env.LIMIT) || 100);
// POS_ONLY=1 spends every credit on known-bad addresses (for tiny free tiers): measures the catch rate only.
const POS_ONLY = process.env.POS_ONLY === '1';
const MAX_POS = POS_ONLY ? LIMIT : Math.floor(LIMIT * 0.4);

async function main() {
  const db = getSupabaseAdmin();
  const { data: ev } = await db.from('calldesk_outreach_email_events').select('message_id, event, detail').in('event', ['bounced', 'complained', 'delivered']).limit(10000);
  const bad = new Set<string>(); const good = new Set<string>();
  for (const e of (ev ?? []) as { message_id: string | null; event: string; detail: { type?: string } | null }[]) {
    if (!e.message_id) continue;
    if (e.event === 'complained' || (e.event === 'bounced' && String(e.detail?.type).toLowerCase() === 'permanent')) bad.add(e.message_id);
    else if (e.event === 'delivered') good.add(e.message_id);
  }
  for (const id of bad) good.delete(id);

  const emailsOf = async (ids: string[]) => {
    const out = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await db.from('calldesk_outreach_messages').select('id, to_email, product').in('id', ids.slice(i, i + 100));
      for (const m of (data ?? []) as { id: string; to_email: string; product: string }[]) out.set(m.to_email.trim().toLowerCase(), m.product);
    }
    return out;
  };
  const pos = [...(await emailsOf([...bad])).entries()].slice(0, MAX_POS);
  const posSet = new Set(pos.map(([e]) => e));
  const pool = POS_ONLY ? [] : [...good].sort(() => Math.random() - 0.5).slice(0, (LIMIT - pos.length) * 2);
  const neg = [...(await emailsOf(pool)).entries()].filter(([e]) => !posSet.has(e)).slice(0, LIMIT - pos.length);
  console.log(`selected ${pos.length} known-bad + ${neg.length} known-delivered = ${pos.length + neg.length} credits`);

  if (!process.env.EMAIL_VERIFY_API_KEY) { console.log('EMAIL_VERIFY_API_KEY not set: selection only, nothing verified.'); return; }
  const tally = (list: [string, string][]) => { const t: Record<string, number> = {}; return { t, run: async () => { for (let i = 0; i < list.length; i += 3) await Promise.all(list.slice(i, i + 3).map(async ([email, product]) => { const r = await verifyMailbox(email); t[r.verdict] = (t[r.verdict] || 0) + 1; if (list === pos || r.verdict === 'undeliverable') console.log(`  ${list === pos ? 'KNOWN-BAD ' : 'FALSE-POS  '} ${r.verdict.padEnd(13)} ${email} [${product}] ${r.detail ?? ''}`); })); } }; };
  const P = tally(pos), N = tally(neg);
  await P.run(); await N.run();
  const v = (t: Record<string, number>, k: Verdict) => t[k] || 0;
  console.log('\nKNOWN-BAD  (n=%d):', pos.length, P.t, '\nKNOWN-GOOD (n=%d):', neg.length, N.t);
  console.log(`caught (undeliverable): ${v(P.t, 'undeliverable')}/${pos.length} = ${(100 * v(P.t, 'undeliverable') / Math.max(1, pos.length)).toFixed(0)}%   | flagged risky/unknown: ${v(P.t, 'risky') + v(P.t, 'unknown')}   | missed: ${v(P.t, 'deliverable')}`);
  console.log(`false positives on good mail: ${v(N.t, 'undeliverable')}/${neg.length}   | risky (catch-all): ${v(N.t, 'risky')}   | unknown: ${v(N.t, 'unknown')}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
