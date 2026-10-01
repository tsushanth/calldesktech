#!/usr/bin/env -S node --import tsx
// Runs stagePhoneBackfill's actual work (findContact: plain HTTP fetch + regex, NOT an LLM call --
// no Claude quota involved at all) in a real continuous loop, independent of runDiscovery's normal
// 9-minute-per-day-per-product window. Built because the dialable pool needs to grow far faster
// than the daily cron's slice allows now that hired callers do 100-200 dials/day each and phone
// outreach is an independent track from email, not gated on it.
//
// Loops in batches until a whole pass over the product's backlog finds nothing left to check
// (every domain already has a phone, or is already marked checked), not until any quota -- there
// isn't one here.
//
//   PRODUCT=calldesk tsx harness/outreach/phone-backfill-continuous.ts
//   PRODUCT=calldesk BATCH=300 CONCURRENCY=20 tsx harness/outreach/phone-backfill-continuous.ts

import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveProduct, leadsTable, scopeToProduct } from '@/lib/outreach/products';
import { findContact } from '@/lib/outreach/discovery/contactPages';

const product = resolveProduct(process.env.PRODUCT);
const BATCH = Math.max(1, Number(process.env.BATCH) || 300);
const CONCURRENCY = Math.max(1, Math.min(30, Number(process.env.CONCURRENCY) || 20));

async function main() {
  const db = getSupabaseAdmin();
  const table = leadsTable(product);
  let totalChecked = 0;
  let totalFound = 0;
  let round = 0;

  for (;;) {
    round++;
    const { data, error } = await scopeToProduct(
      db.from(table).select('id, company_name, domain, signals')
        .eq('contact_status', 'found').eq('region_blocked', false).is('phone', null).not('domain', 'is', null)
        .is('signals->>phoneCheckedAt', null),
      product,
    ).order('score', { ascending: false }).limit(BATCH);

    if (error) { console.error(`round ${round}: query failed: ${error.message}`); break; }
    const leads = (data ?? []) as { id: string; company_name: string; domain: string; signals: Record<string, unknown> | null }[];
    if (leads.length === 0) {
      console.log(`round ${round}: nothing left to check -- backlog exhausted. Total: ${totalChecked} checked, ${totalFound} phones found.`);
      break;
    }

    let roundFound = 0;
    for (let i = 0; i < leads.length; i += CONCURRENCY) {
      const batch = leads.slice(i, i + CONCURRENCY);
      await Promise.allSettled(batch.map(async (lead) => {
        try {
          if ((lead.signals as { registry?: { callerPhoneExcluded?: string } } | null)?.registry?.callerPhoneExcluded) return; // personal/home line policy
          const contact = await findContact(lead.domain);
          const now = new Date().toISOString();
          const signals = { ...(lead.signals ?? {}), phoneCheckedAt: now };
          const update: Record<string, unknown> = { signals };
          if (contact.phone) { update.phone = contact.phone; roundFound++; }
          const { error: updErr } = await db.from(table).update(update).eq('id', lead.id);
          if (updErr) console.error(`  update failed for ${lead.company_name}: ${updErr.message}`);
        } catch (e) {
          console.error(`  fetch failed for ${lead.company_name} (${lead.domain}): ${e instanceof Error ? e.message : String(e)}`);
        }
      }));
    }
    totalChecked += leads.length;
    totalFound += roundFound;
    console.log(`round ${round}: checked ${leads.length} (found ${roundFound} phones) -- running total ${totalChecked} checked, ${totalFound} found`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
