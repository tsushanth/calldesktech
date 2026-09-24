import { getSupabaseAdmin } from '@/lib/supabase';
import { bulkImportRegistry, bulkRegistrySourcesFor } from '@/lib/outreach/discovery/pipeline';
import { resolveProduct } from '@/lib/outreach/products';

// One-off: import a whole email-bearing public registry for a vertical.
//   PRODUCT=insurance DRY_RUN=1 tsx bulk-import.ts               -> counts only (fl-dfs, the only insurance source)
//   PRODUCT=homeservices SOURCE=va-dpor DRY_RUN=1 tsx bulk-import.ts
//   PRODUCT=homeservices SOURCE=va-dpor tsx bulk-import.ts       -> insert
// SOURCE defaults to the vertical's only source, and is required when it has more
// than one (homeservices: nyc-dob | va-dpor | ar-clb).
// Idempotent; safe to re-run. Sending stays a manual click in the admin queue.
async function main() {
  const product = resolveProduct(process.env.PRODUCT);
  const dryRun = process.env.DRY_RUN === '1';
  const available = bulkRegistrySourcesFor(product);
  if (!available.length) throw new Error(`no bulk registry import for ${product.id}`);
  const source = process.env.SOURCE ?? (available.length === 1 ? available[0] : '');
  if (!source) throw new Error(`SOURCE is required for ${product.id} (one of: ${available.join(', ')})`);
  const started = Date.now();
  const result = await bulkImportRegistry(getSupabaseAdmin(), product, source, { dryRun, log: (m) => console.log(`[bulk-import ${product.id}/${source}] ${m}`) });
  console.log(JSON.stringify({ product: product.id, source, dryRun, seconds: Math.round((Date.now() - started) / 1000), ...result }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
