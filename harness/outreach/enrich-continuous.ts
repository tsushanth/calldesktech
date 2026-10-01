#!/usr/bin/env -S node --import tsx
// Continuous website-discovery + contact enrichment for registry leads that have never been enriched,
// independent of the daily run's ~9 minute budget. Each batch is stageEnrich (the same code the daily
// run uses): a Claude web search finds the business's own site, the page is verified against the
// registry name/city/phone, then the contact email/phone are scraped from it.
//
// Parallelism: stageEnrich shells out synchronously, so run SEVERAL processes with different SHARDs.
//
//   SOURCES=homeservices:va,childcare:tx PRODUCTS=homeservices,childcare SHARD=0/4 \
//     OUTREACH_WEBSEARCH_MAX_PER_RUN=30 tsx harness/outreach/enrich-continuous.ts
//   MAX_BATCHES=1 ...   # pilot: a single batch of BATCH leads, then exit
//
// Leads named after a person (sole proprietors) are skipped by default (SKIP_INDIVIDUALS=0 to include them).
// Stops when nothing is left, when ~/.calldesk-enrich/STOP exists, or after MAX_BATCHES.
import fs from 'node:fs';
import os from 'node:os';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveProduct } from '@/lib/outreach/products';
import { enrichBacklogBatch } from '@/lib/outreach/discovery/pipeline';

const STOP = `${os.homedir()}/.calldesk-enrich/STOP`;
const BATCH = Math.min(30, Math.max(1, Number(process.env.BATCH) || 30));
const MAX_BATCHES = Number(process.env.MAX_BATCHES) || Infinity;
const [si, sc] = (process.env.SHARD || '0/1').split('/').map(Number);
const prefixes = (process.env.SOURCES || '').split(',').map((s) => s.trim()).filter(Boolean);
const products = (process.env.PRODUCTS || 'homeservices').split(',').map((s) => s.trim()).filter(Boolean);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), `[shard ${si}/${sc}]`, ...a);

async function main() {
  process.env.OUTREACH_WEBSEARCH_MAX_PER_RUN = String(BATCH);
  const db = getSupabaseAdmin();
  let batches = 0; let found = 0; let done = 0;
  for (const id of products) {
    const product = resolveProduct(id);
    for (;;) {
      if (fs.existsSync(STOP)) { log('STOP file present, exiting'); return; }
      if (batches >= MAX_BATCHES) { log('MAX_BATCHES reached'); return; }
      const r = await enrichBacklogBatch(db, product, { limit: BATCH, sourcePrefixes: prefixes, shard: { index: si, count: sc }, skipIndividuals: process.env.SKIP_INDIVIDUALS !== '0' });
      batches++; found += r.contactsFound;
      const attempted = Object.values(r.statuses).reduce((a, b) => a + b, 0);
      done += attempted;
      log(`${id}: pending-before ${r.pending}, batch attempted ${attempted}, contacts ${r.contactsFound} | totals: ${done} processed, ${found} contacts`, JSON.stringify(r.statuses), r.errors.length ? `errors: ${r.errors.slice(0, 2).join(' | ').slice(0, 200)}` : '');
      if (r.pending === 0 || (attempted === 0 && r.searchFailures === 0)) { log(`${id}: nothing left in scope`); break; }
      if (r.searchFailures >= 3) { log('claude search failing (limit/outage?), backing off 10 min'); await sleep(600_000); }
    }
  }
  log('ALL DONE', { done, found });
}
main().catch((e) => { console.error(e); process.exit(1); });
