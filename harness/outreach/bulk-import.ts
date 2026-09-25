import { getSupabaseAdmin } from '@/lib/supabase';
import { bulkImportRegistry, bulkRegistrySourcesFor } from '@/lib/outreach/discovery/pipeline';
import { resolveProduct } from '@/lib/outreach/products';
import { importReadaloudSource } from '@/lib/outreach/discovery/readaloud/import';
import { RA_SOURCE_IDS } from '@/lib/outreach/discovery/readaloud/common';

// One-off: import a whole email-bearing public registry for a vertical.
//   PRODUCT=insurance DRY_RUN=1 tsx bulk-import.ts               -> counts only (fl-dfs, the only insurance source)
//   PRODUCT=homeservices SOURCE=va-dpor DRY_RUN=1 tsx bulk-import.ts
//   PRODUCT=homeservices SOURCE=va-dpor tsx bulk-import.ts       -> insert
// SOURCE defaults to the vertical's only source, and is required when it has more
// than one (homeservices: nyc-dob | va-dpor | ar-clb).
//
// readaloud (PRODUCT=readaloud) has its own lead sources, which are not registries
// (see src/lib/outreach/discovery/readaloud/import.ts):
//   PRODUCT=readaloud SOURCE=ra-yc-voice DRY_RUN=1 tsx bulk-import.ts   -> counts; reads the DB for dedupe
//   PRODUCT=readaloud SOURCE=ra-yc-voice NO_DB=1 tsx bulk-import.ts     -> counts; no DB at all
//   PRODUCT=readaloud SOURCE=ra-yc-voice tsx bulk-import.ts             -> insert new, merge facts into existing
// Idempotent; safe to re-run. Sending stays a manual click in the admin queue.
async function main() {
  const product = resolveProduct(process.env.PRODUCT);
  const dryRun = process.env.DRY_RUN === '1';
  const started = Date.now();

  if (product.id === 'readaloud') {
    const source = process.env.SOURCE ?? '';
    if (!source) throw new Error(`SOURCE is required for readaloud (one of: ${RA_SOURCE_IDS.join(', ')})`);
    const noDb = process.env.NO_DB === '1';
    const result = await importReadaloudSource(noDb ? null : getSupabaseAdmin(), source, {
      dryRun: dryRun || noDb, log: (m) => console.log(`[bulk-import readaloud/${source}] ${m}`),
    });
    console.log(JSON.stringify({ product: product.id, seconds: Math.round((Date.now() - started) / 1000), ...result }, null, 2));
    return;
  }

  const available = bulkRegistrySourcesFor(product);
  if (!available.length) throw new Error(`no bulk registry import for ${product.id}`);
  const source = process.env.SOURCE ?? (available.length === 1 ? available[0] : '');
  if (!source) throw new Error(`SOURCE is required for ${product.id} (one of: ${available.join(', ')})`);
  const result = await bulkImportRegistry(getSupabaseAdmin(), product, source, { dryRun, log: (m) => console.log(`[bulk-import ${product.id}/${source}] ${m}`) });
  console.log(JSON.stringify({ product: product.id, source, dryRun, seconds: Math.round((Date.now() - started) / 1000), ...result }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
