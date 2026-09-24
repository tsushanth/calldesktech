import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveProduct, leadsTable, scopeToProduct } from '@/lib/outreach/products';
import { decideRelease } from '@/lib/outreach/discovery/registryCommon';

// RELEASE ONE COUNTRY FROM THE INTERNATIONAL HOLD.
//
// Every lead ingested from a non-US public register is stored ON HOLD:
// `region_blocked = true` plus `signals.intlHold = { country, reason }` (applied
// centrally in discovery/pipeline.ts registryLeadRow). While the hold stands the
// lead is completely inert — stageEnrich will not even look up its website,
// stageDraft and the contact-form stage only select `region_blocked = false`
// rows, and sender.ts re-reads the flag and refuses to send. So nothing
// international can be drafted or emailed by accident.
//
// This script is the ONLY intended way out of that state, and it is a manual,
// per-country, human decision that should follow a compliance review of that
// country's marketing-email rules. It flips region_blocked to false for the leads
// whose signals.intlHold.country matches COUNTRY. The next ordinary discovery run
// then picks them up for website/email discovery and drafting, and the drafts
// still have to be approved by hand in the admin queue as usual.
//
//   COUNTRY=FR DRY_RUN=1 tsx release-country.ts                 -> count only, changes nothing
//   COUNTRY=FR PRODUCT=homeservices DRY_RUN=1 tsx release-country.ts
//   COUNTRY=FR PRODUCT=homeservices tsx release-country.ts      -> release
//
// PRODUCT selects which vertical's lead table to work on and defaults to the
// harness default; COUNTRY is an ISO-3166 alpha-2 code and is required.
//
// DE, AT, CH and LI can NEVER be released: they require prior consent even for
// B2B marketing email (see discovery/score.ts). The script refuses them outright
// rather than relying on the operator to remember.
async function main() {
  // The whole gate lives in registryCommon.decideRelease so it is unit tested; DE,
  // AT, CH and LI are refused here and can never be released.
  const decision = decideRelease(process.env.COUNTRY);
  if (!decision.ok) throw new Error(decision.reason);
  const country = decision.country;

  const product = resolveProduct(process.env.PRODUCT);
  const dryRun = process.env.DRY_RUN === '1';
  const db = getSupabaseAdmin();
  const table = leadsTable(product);

  // Matched on the stored hold, not on the location text, so a lead can only be
  // released by the country it was actually ingested as. `->>` is a JSON text
  // accessor, so the comparison is against the exact stored code.
  const held = scopeToProduct(
    db.from(table).select('id, company_name, location, region_blocked, signals').eq('region_blocked', true),
    product,
  ).filter('signals->intlHold->>country', 'eq', country);

  const { data, error } = await held;
  if (error) throw new Error(`select: ${error.message}`);
  const rows = (data ?? []) as { id: string; company_name: string; location: string | null }[];

  console.log(JSON.stringify({
    product: product.id,
    table,
    country,
    dryRun,
    held: rows.length,
    sample: rows.slice(0, 5).map((r) => ({ name: r.company_name, location: r.location })),
  }, null, 2));

  if (dryRun) {
    console.log(`DRY RUN: ${rows.length} ${product.id} lead(s) on hold for ${country} would be released. Nothing was changed.`);
    return;
  }
  if (!rows.length) {
    console.log(`nothing to release for ${country} in ${table}`);
    return;
  }

  // Updated in chunks by id, so the update can only ever touch the rows that were
  // just listed — never a broader match.
  const CHUNK = 500;
  let released = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const ids = rows.slice(i, i + CHUNK).map((r) => r.id);
    const { error: e1 } = await db.from(table).update({ region_blocked: false }).in('id', ids);
    if (e1) throw new Error(`update: ${e1.message}`);
    released += ids.length;
    console.log(`released ${released}/${rows.length}`);
  }
  console.log(`released ${released} ${product.id} lead(s) for ${country}. signals.intlHold is left in place as the audit trail.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
