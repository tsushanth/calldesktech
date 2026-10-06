#!/usr/bin/env -S node --import tsx
// Turn a day's logged voicemail / no-answer calls into "we tried calling you" email drafts (see callHookEmail.ts). Drafts only: they wait in
// the review queue; nothing is approved or sent here. For each lead:
//   no email message yet            -> new step-1 draft
//   step-1 sent, no step 2          -> new step-2 draft (follow-up priority in autosend)
//   step-1 still draft/approved     -> its subject and body are replaced in place (status unchanged)
// Skips leads without an email, replied, region-blocked, suppressed, or failing the pre-draft address check.
//
//   DATE=2026-10-05 DRY_RUN=1 tsx harness/outreach/call-hook-drafts.ts      # preview, writes nothing
//   DATE=2026-10-05 tsx harness/outreach/call-hook-drafts.ts
import { getSupabaseAdmin } from '@/lib/supabase';
import { buildCallHookEmail, type HookOutcome } from '@/lib/outreach/callHookEmail';
import { preDraftEmailCheck } from '@/lib/outreach/emailTypo';

const DRY = process.env.DRY_RUN === '1';
const date = process.env.DATE || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

async function main() {
  const db = getSupabaseAdmin();
  const { data: batch, error } = await db.from('calldesk_call_batches').select('lead_id, state, outcome, outcome_at').eq('batch_date', date).in('outcome', ['no_answer', 'voicemail']);
  if (error) throw new Error(error.message);
  const byLead = new Map<string, { state: string | null; outcome: HookOutcome; outcome_at: string | null }>();
  for (const b of (batch ?? []) as { lead_id: string; state: string | null; outcome: HookOutcome; outcome_at: string | null }[]) byLead.set(b.lead_id, b);
  const ids = [...byLead.keys()];
  console.log(`${date}: ${ids.length} leads with a voicemail or no-answer call`);
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  let created1 = 0, created2 = 0, rewritten = 0;
  const samples: string[] = [];

  const sup = new Set(((await db.from('calldesk_outreach_suppressions').select('email')).data ?? []).map((s: { email: string }) => s.email.toLowerCase()));
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data: leads } = await db.from('calldesk_outreach_leads').select('id, company_name, contact_email, product, region_blocked, replied_at').in('id', chunk);
    const { data: msgs } = await db.from('calldesk_outreach_messages').select('id, lead_id, step, status').in('lead_id', chunk).neq('status', 'rejected');
    const { data: calls } = await db.from('calldesk_outbound_calls').select('lead_id, started_at').in('lead_id', chunk).gte('started_at', `${date}T00:00:00-08:00`).order('started_at', { ascending: false });
    const lastCall = new Map<string, string>();
    for (const c of (calls ?? []) as { lead_id: string; started_at: string }[]) if (!lastCall.has(c.lead_id)) lastCall.set(c.lead_id, c.started_at);

    for (const lead of (leads ?? []) as { id: string; company_name: string; contact_email: string | null; product: string | null; region_blocked: boolean | null; replied_at: string | null }[]) {
      const b = byLead.get(lead.id)!;
      if (!lead.contact_email) { skip('no email'); continue; }
      if (lead.replied_at) { skip('replied'); continue; }
      if (lead.region_blocked) { skip('region blocked'); continue; }
      if (sup.has(lead.contact_email.toLowerCase())) { skip('suppressed'); continue; }
      const chk = await preDraftEmailCheck(lead.contact_email);
      if (!chk.ok) { skip(`address check: ${chk.reason}`); continue; }
      const calledAt = new Date(lastCall.get(lead.id) ?? b.outcome_at ?? Date.now());
      const { subject, body } = buildCallHookEmail({ company: lead.company_name, product: lead.product, outcome: b.outcome, calledAt, state: b.state });
      const mine = ((msgs ?? []) as { id: string; lead_id: string; step: number | null; status: string }[]).filter((m) => m.lead_id === lead.id);
      const step1 = mine.find((m) => (m.step ?? 1) === 1);
      const step2 = mine.find((m) => m.step === 2);
      if (samples.length < 2) samples.push(`${lead.company_name} <${chk.email}>\n  ${subject}\n${body.split('\n').map((l) => '  ' + l).join('\n')}`);

      if (!step1) {
        if (!DRY) { const { error: e } = await db.from('calldesk_outreach_messages').insert({ lead_id: lead.id, to_email: chk.email, subject, body_text: body, status: 'draft', step: 1, product: lead.product ?? 'calldesk' }); if (e && (e as { code?: string }).code !== '23505') throw new Error(e.message); if (e) { skip('step 1 exists'); continue; } }
        created1++;
      } else if (step1.status === 'sent') {
        if (step2) { skip('step 2 exists'); continue; }
        if (!DRY) { const { error: e } = await db.from('calldesk_outreach_messages').insert({ lead_id: lead.id, to_email: chk.email, subject, body_text: body, status: 'draft', step: 2, product: lead.product ?? 'calldesk' }); if (e && (e as { code?: string }).code !== '23505') throw new Error(e.message); if (e) { skip('step 2 exists'); continue; } }
        created2++;
      } else if (step1.status === 'draft' || step1.status === 'approved') {
        if (!DRY) { const { error: e } = await db.from('calldesk_outreach_messages').update({ subject, body_text: body }).eq('id', step1.id); if (e) throw new Error(e.message); }
        rewritten++;
      } else { skip(`step 1 is ${step1.status}`); }
    }
  }
  console.log(JSON.stringify({ dryRun: DRY, newStep1Drafts: created1, newStep2Drafts: created2, rewrittenPending: rewritten, skipped }, null, 1));
  for (const s of samples) console.log('\n--- sample ---\n' + s);
}
main().catch((e) => { console.error(e); process.exit(1); });
