#!/usr/bin/env -S node --import tsx
// Side-by-side sample of the new pain-point pitch against the draft already in the review queue, for a few leads
// per vertical. Reads the lead's own site, picks an angle (businessBrief.ts), writes a NEW draft in memory and prints
// it next to the old one. Writes NOTHING to the database and sends nothing.
//
//   PER=3 VERTICALS=dental,bailbonds,homecare OUTREACH_LLM=cli tsx harness/outreach/pitch-sample.ts > samples.md
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveProduct, leadsTable, messagesTable, scopeToProduct } from '@/lib/outreach/products';
import { draftAgencyEmail } from '@/lib/outreach/agencyDraft';
import { fetchSiteSignals, chooseAngle } from '@/lib/outreach/businessBrief';

const PER = Math.max(1, Number(process.env.PER) || 3);
const VERTICALS = (process.env.VERTICALS || 'dental,homeservices,bailbonds,homecare,towing,childcare').split(',').map((s) => s.trim()).filter(Boolean);

(async () => {
  const db = getSupabaseAdmin();
  const tally: Record<string, number> = {};
  for (const v of VERTICALS) {
    const product = resolveProduct(v);
    const { data: msgs } = await scopeToProduct(db.from(messagesTable(product)).select('lead_id,subject,body_text').eq('status', 'draft').eq('step', 1), product).limit(200);
    const byLead = new Map((msgs ?? []).map((m: { lead_id: string; subject: string; body_text: string }) => [m.lead_id, m]));
    const { data: leads } = await scopeToProduct(db.from(leadsTable(product)).select('id,company_name,domain,location,description,tier,research').not('domain', 'is', null).in('id', [...byLead.keys()].slice(0, 120)), product).limit(120);
    let shown = 0;
    console.log(`\n# ${v}\n`);
    for (const lead of (leads ?? []) as { id: string; company_name: string; domain: string; location: string | null; description: string | null; tier: string | null; research: never }[]) {
      if (shown >= PER) break;
      const site = await fetchSiteSignals(lead.domain);
      if (!site) continue;
      const angle = chooseAngle(product.id.replace(/^calldesk:/, ''), site.signals);
      const draft = await draftAgencyEmail({ name: lead.company_name, domain: lead.domain, tier: lead.tier, location: lead.location, description: lead.description, dossier: null, product, angle });
      const old = byLead.get(lead.id) as { subject: string; body_text: string };
      tally[angle.id] = (tally[angle.id] || 0) + 1;
      shown++;
      console.log(`## ${lead.company_name} (${lead.domain}) | angle: ${angle.id}${angle.evidence ? '' : ' (default, nothing found on site)'}`);
      if (angle.evidence) console.log(`site fact: ${angle.evidence}`);
      console.log(`\nOLD subject: ${old.subject}\n${old.body_text.replace(/\n\nSushanth[\s\S]*$/, '')}\n\nNEW subject: ${draft.subject}\n${draft.body.replace(/\n\nSushanth[\s\S]*$/, '')}\n\n---\n`);
    }
  }
  console.log(`\nAngles chosen: ${JSON.stringify(tally)}`);
})().catch((e) => { console.error(e); process.exit(1); });
