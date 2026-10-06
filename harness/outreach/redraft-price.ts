#!/usr/bin/env -S node --import tsx
// Rewrites the UNSENT first-touch emails to resellers (Calldesk agencies and readaloudai.org speech-API leads) so they lead with
// the price and offer both routes: the Calldesk platform and the speech API for a platform the agency already owns.
// Messages that were already approved are put back to 'approved' only if the rewrite passes the checks below (the owner asked for
// this change, so the approval carries over); otherwise they stay 'draft' for a human. Sent messages are never touched.
//
// Reversible: the old subject, body and status are kept on the lead at signals.priceLead.previous.
//
//   PRODUCT=calldesk LIMIT=200 DRY_RUN=1 OUTREACH_LLM=cli tsx harness/outreach/redraft-price.ts
//   PRODUCT=readaloud SHARD=1/3 ...
import fs from 'node:fs';
import os from 'node:os';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveProduct, leadsTable, messagesTable, scopeToProduct } from '@/lib/outreach/products';
import { draftAgencyEmail } from '@/lib/outreach/agencyDraft';
import { checkPriceLed } from '@/lib/outreach/priceLed';

const STOP = `${os.homedir()}/.calldesk-backlog/STOP`;
const product = resolveProduct(process.env.PRODUCT || 'calldesk');
const LIMIT = Math.max(1, Number(process.env.LIMIT) || 100);
const DRY = process.env.DRY_RUN === '1';
const [shardIdx, shardCount] = (process.env.SHARD || '0/1').split('/').map(Number);
const inShard = (id: string) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % shardCount === shardIdx; };

type Msg = { id: string; lead_id: string; subject: string; body_text: string; status: string };
type Lead = { id: string; company_name: string; domain: string | null; location: string | null; description: string | null; tier: string | null; signals: Record<string, unknown> | null; research: never };

(async () => {
  const db = getSupabaseAdmin();
  const { data: msgs } = await scopeToProduct(db.from(messagesTable(product)).select('id,lead_id,subject,body_text,status').eq('status', 'draft').eq('step', 1), product).limit(2000);
  const byLead = new Map<string, Msg>(((msgs ?? []) as Msg[]).filter((m) => inShard(m.lead_id)).map((m) => [m.lead_id, m]));
  const ids = [...byLead.keys()];
  let done = 0, kept = 0, failed = 0, restored = 0;
  for (let i = 0; i < ids.length && done < LIMIT; i += 100) {
    const { data: leads } = await scopeToProduct(db.from(leadsTable(product)).select('id,company_name,domain,location,description,tier,signals,research').in('id', ids.slice(i, i + 100)), product);
    for (const lead of (leads ?? []) as Lead[]) {
      if (done >= LIMIT || fs.existsSync(STOP)) break;
      const old = byLead.get(lead.id)!;
      if ((lead.signals as { priceLead?: { done?: boolean } } | null)?.priceLead?.done) { kept++; continue; }
      try {
        const draft = await draftAgencyEmail({ name: lead.company_name, domain: lead.domain, tier: lead.tier, location: lead.location, description: lead.description, dossier: lead.research ?? null, product });
        const problem = checkPriceLed(draft.subject, draft.body);
        const wasApproved = (lead.signals as { priceLead?: { previousStatus?: string } } | null)?.priceLead?.previousStatus === 'approved';
        console.log(`${DRY ? '[dry] ' : ''}${lead.company_name}: ${problem ? 'REJECTED (' + problem + ')' : 'ok'}  | ${draft.subject}`);
        if (DRY) { done++; continue; }
        if (problem) { failed++; continue; } // keep the old text as a draft for a human
        const status = wasApproved ? 'approved' : 'draft';
        const { error } = await db.from(messagesTable(product)).update({ subject: draft.subject, body_text: draft.body, status }).eq('id', old.id).eq('status', 'draft');
        if (error) { failed++; console.log('  update failed: ' + error.message); continue; }
        await db.from(leadsTable(product)).update({ signals: { ...(lead.signals ?? {}), priceLead: { done: true, previousStatus: wasApproved ? 'approved' : 'draft', at: new Date().toISOString(), previous: { subject: old.subject, body: old.body_text } } } }).eq('id', lead.id);
        done++; if (wasApproved) restored++;
      } catch (e) { failed++; console.log(`  draft failed ${lead.company_name}: ${e instanceof Error ? e.message.slice(0, 90) : e}`); }
    }
  }
  console.log(`${product.id} shard ${shardIdx}/${shardCount}: rewritten ${done} (approvals carried over ${restored}), kept ${kept}, rejected or failed ${failed}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
