#!/usr/bin/env -S node --import tsx
// Prints NEW reseller first-touch drafts (current offer facts and rules) for a few leads, with the price-led check result.
// Writes NOTHING to the database and sends nothing.
//
//   PRODUCT=calldesk PER=3 OUTREACH_LLM=cli tsx harness/outreach/reseller-sample.ts
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveProduct, leadsTable, messagesTable, scopeToProduct } from '@/lib/outreach/products';
import { draftAgencyEmail } from '@/lib/outreach/agencyDraft';
import { checkPriceLed } from '@/lib/outreach/priceLed';

const product = resolveProduct(process.env.PRODUCT || 'calldesk');
const PER = Math.max(1, Number(process.env.PER) || 3);

(async () => {
  const db = getSupabaseAdmin();
  const { data: msgs } = await scopeToProduct(db.from(messagesTable(product)).select('lead_id').eq('status', 'draft').eq('step', 1), product).limit(100);
  const ids = (msgs ?? []).map((m: { lead_id: string }) => m.lead_id);
  const { data: leads } = await scopeToProduct(db.from(leadsTable(product)).select('id,company_name,domain,location,description,tier,research').in('id', ids).not('domain', 'is', null), product).limit(PER * 4);
  let shown = 0;
  for (const lead of (leads ?? []) as { company_name: string; domain: string | null; location: string | null; description: string | null; tier: string | null; research: never }[]) {
    if (shown >= PER) break;
    try {
      const d = await draftAgencyEmail({ name: lead.company_name, domain: lead.domain, tier: lead.tier, location: lead.location, description: lead.description, dossier: lead.research ?? null, product });
      console.log(`\n=== ${lead.company_name} (${lead.domain}) | check: ${checkPriceLed(d.subject, d.body) ?? 'ok'} | ${d.body.split(/\s+/).length} words\nSubject: ${d.subject}\n\n${d.body}\n`);
      shown++;
    } catch (e) { console.log(`draft failed for ${lead.company_name}: ${e instanceof Error ? e.message.slice(0, 120) : e}`); }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
