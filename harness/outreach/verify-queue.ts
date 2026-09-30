#!/usr/bin/env -S node --import tsx
// One-off pre-screen of the APPROVED outreach queue (all lanes) with the mailbox verification API, so
// bad addresses are pulled out before autosend reaches them. Needs EMAIL_VERIFY_API_KEY (and optionally
// EMAIL_VERIFY_PROVIDER). Results are cached on each lead, so the send-time check does not pay again.
//
//   tsx harness/outreach/verify-queue.ts            # dry run: verifies + reports, changes nothing
//   APPLY=1 tsx harness/outreach/verify-queue.ts    # also marks undeliverable messages failed + suppresses them
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyLeadEmail, shouldBlock } from '@/lib/outreach/emailVerify';

const APPLY = process.env.APPLY === '1';
const CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.CONCURRENCY) || 5));

async function main() {
  if (!process.env.EMAIL_VERIFY_API_KEY) { console.error('EMAIL_VERIFY_API_KEY is not set'); process.exit(1); }
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('calldesk_outreach_messages')
    .select('id, to_email, product, lead_id, lead:calldesk_outreach_leads(id, signals)')
    .eq('status', 'approved').order('created_at', { ascending: true }).limit(2000);
  if (error) throw new Error(error.message);
  type Row = { id: string; to_email: string; product: string; lead_id: string; lead: { id: string; signals: Record<string, unknown> | null } | { id: string; signals: Record<string, unknown> | null }[] | null };
  const rows = (data ?? []) as Row[];
  console.log(`${rows.length} approved messages; ${APPLY ? 'APPLY' : 'dry run'}`);

  const tally: Record<string, number> = {};
  const bad: { id: string; email: string; product: string; detail: string; provider: string }[] = [];
  let cached = 0;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(rows.slice(i, i + CONCURRENCY).map(async (r) => {
      const lead = Array.isArray(r.lead) ? r.lead[0] : r.lead;
      const v = await verifyLeadEmail(db, lead ?? null, r.to_email);
      if (v.cached) cached++;
      tally[v.verdict] = (tally[v.verdict] || 0) + 1;
      if (shouldBlock(v)) bad.push({ id: r.id, email: r.to_email.toLowerCase(), product: r.product, detail: v.detail || v.verdict, provider: v.provider });
    }));
  }
  console.log('verdicts:', tally, `(${cached} from cache)`);
  for (const b of bad) console.log(`  BAD ${b.product} ${b.email} - ${b.detail}`);
  if (APPLY) {
    for (const b of bad) {
      await db.from('calldesk_outreach_messages').update({ status: 'failed', error: `mailbox verification: ${b.detail}` }).eq('id', b.id);
      await db.from('calldesk_outreach_suppressions').upsert({ email: b.email, reason: `mailbox verification: ${b.detail} [${b.provider}]` }, { onConflict: 'email' });
    }
    console.log(`applied: ${bad.length} messages failed + suppressed`);
  } else if (bad.length) console.log('dry run: rerun with APPLY=1 to pull these from the queue');
}
main().catch((e) => { console.error(e); process.exit(1); });
