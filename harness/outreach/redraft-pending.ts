#!/usr/bin/env -S node --import tsx
// Rewrites the UNREVIEWED vertical drafts (status 'draft', step 1) that have something specific on the lead's own site
// to draft around (businessBrief.ts), replacing the one-size "what happens after hours?" question. Drafts whose site shows
// nothing keep their text. Approved and sent messages are never touched.
//
// Reversible: the old subject and body are kept on the lead at signals.brief.previous, and the message keeps its id.
//
//   VERTICAL=bailbonds LIMIT=50 DRY_RUN=1 OUTREACH_LLM=cli tsx harness/outreach/redraft-pending.ts
//   VERTICAL=bailbonds LIMIT=50           OUTREACH_LLM=cli tsx harness/outreach/redraft-pending.ts
// Stops when ~/.calldesk-backlog/STOP exists. Shard with SHARD=i/n like research-backlog.ts.
import fs from 'node:fs';
import os from 'node:os';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveProduct, leadsTable, messagesTable, scopeToProduct } from '@/lib/outreach/products';
import { draftAgencyEmail } from '@/lib/outreach/agencyDraft';
import { fetchSiteSignals, chooseAngle } from '@/lib/outreach/businessBrief';
import { detectDraftLanguage } from '@/lib/outreach/language';

const STOP = `${os.homedir()}/.calldesk-backlog/STOP`;
const vertical = process.env.VERTICAL || '';
const LIMIT = Math.max(1, Number(process.env.LIMIT) || 50);
const DRY = process.env.DRY_RUN === '1';
const [shardIdx, shardCount] = (process.env.SHARD || '0/1').split('/').map(Number);
const inShard = (id: string) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % shardCount === shardIdx; };

(async () => {
  if (!vertical) throw new Error('VERTICAL is required, e.g. VERTICAL=bailbonds');
  const db = getSupabaseAdmin();
  const product = resolveProduct(vertical);
  const { data: msgs } = await scopeToProduct(db.from(messagesTable(product)).select('id,lead_id,subject,body_text').eq('status', 'draft').eq('step', 1), product).limit(3000);
  type Msg = { lead_id: string; id: string; subject: string; body_text: string };
  const byLead = new Map<string, Msg>(((msgs ?? []) as Msg[]).filter((m) => inShard(m.lead_id)).map((m) => [m.lead_id, m]));
  const ids = [...byLead.keys()];
  let done = 0, kept = 0, failed = 0, scanned = 0;
  const tally: Record<string, number> = {};
  for (let i = 0; i < ids.length && done < LIMIT; i += 100) {
    const { data: leads } = await scopeToProduct(db.from(leadsTable(product)).select('id,company_name,domain,location,description,tier,signals,research').not('domain', 'is', null).in('id', ids.slice(i, i + 100)), product);
    for (const lead of (leads ?? []) as { id: string; company_name: string; domain: string; location: string | null; description: string | null; tier: string | null; signals: Record<string, unknown> | null; research: never }[]) {
      if (done >= LIMIT || fs.existsSync(STOP)) break;
      if (detectDraftLanguage(lead.location ?? null) || (lead.signals as { brief?: unknown } | null)?.brief) { kept++; continue; }
      scanned++;
      const site = await fetchSiteSignals(lead.domain).catch(() => null);
      const angle = site ? chooseAngle(vertical, site.signals) : null;
      if (!angle?.evidence) { kept++; continue; }
      const old = byLead.get(lead.id)!;
      try {
        const draft = await draftAgencyEmail({ name: lead.company_name, domain: lead.domain, tier: lead.tier, location: lead.location, description: lead.description, dossier: null, product, angle });
        tally[angle.id] = (tally[angle.id] || 0) + 1;
        console.log(`${DRY ? '[dry] ' : ''}${lead.company_name} -> ${angle.id}: ${angle.evidence}`);
        if (DRY) { done++; continue; }
        const { error: e1 } = await db.from(messagesTable(product)).update({ subject: draft.subject, body_text: draft.body }).eq('id', old.id).eq('status', 'draft');
        if (e1) { failed++; console.log('  update failed: ' + e1.message); continue; }
        await db.from(leadsTable(product)).update({ signals: { ...(lead.signals ?? {}), brief: { angle: angle.id, evidence: angle.evidence, at: new Date().toISOString(), previous: { subject: old.subject, body: old.body_text } } } }).eq('id', lead.id);
        done++;
      } catch (e) { failed++; console.log(`  draft failed ${lead.company_name}: ${e instanceof Error ? e.message.slice(0, 90) : e}`); }
    }
  }
  console.log(`${vertical} shard ${shardIdx}/${shardCount}: rewritten ${done}, kept (no site signal / non-English / already briefed) ${kept}, failed ${failed}, angles ${JSON.stringify(tally)}`);
})().catch((e) => { console.error(e); process.exit(1); });
