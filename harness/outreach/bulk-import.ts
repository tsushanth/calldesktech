import { getSupabaseAdmin } from '@/lib/supabase';
import { bulkImportFlDfs } from '@/lib/outreach/discovery/pipeline';
import { resolveProduct } from '@/lib/outreach/products';

// One-off: import the whole Florida DFS licensee list for a vertical (insurance | bailbonds).
//   PRODUCT=insurance DRY_RUN=1 tsx bulk-import.ts    -> counts only
//   PRODUCT=insurance tsx bulk-import.ts               -> insert
// Idempotent; safe to re-run. Sending stays a manual click in the admin queue.
async function main() {
  const product = resolveProduct(process.env.PRODUCT);
  const dryRun = process.env.DRY_RUN === '1';
  const started = Date.now();
  const result = await bulkImportFlDfs(getSupabaseAdmin(), product, { dryRun, log: (m) => console.log(`[bulk-import ${product.id}] ${m}`) });
  console.log(JSON.stringify({ product: product.id, dryRun, seconds: Math.round((Date.now() - started) / 1000), ...result }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
