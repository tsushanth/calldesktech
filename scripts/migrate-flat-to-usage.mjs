#!/usr/bin/env node
// Migrates any subscriber still on the old flat $39/mo plan
// (price_1SekfDKFBTQTkmzt9Qx2rYWY) onto the real usage-based metered plan
// (see USAGE_PRICES in src/lib/constants.ts). Written 2026-08-28 as
// prophylactic tooling — as of that date there are zero active
// subscriptions on the flat price (confirmed directly against Stripe), so
// this has never needed to run for real. It exists so a future subscriber
// on the old plan (a stale link, a support workaround, whatever) has a
// safe, auditable path off it instead of someone hand-editing Stripe.
//
// Defaults to a dry run — prints what it WOULD change, changes nothing.
// Pass --execute to actually perform the migration.
//
// Usage:
//   node scripts/migrate-flat-to-usage.mjs            # dry run
//   node scripts/migrate-flat-to-usage.mjs --execute   # actually migrate

import { readFileSync } from 'node:fs';

const FLAT_PRICE_ID = 'price_1SekfDKFBTQTkmzt9Qx2rYWY';
const USAGE_PRICES = {
  voiceKokoro: 'price_1U8tJeKFBTQTkmztTPNMcLKe',
  booking: 'price_1U8tJtKFBTQTkmzt8CqFVIDs',
  transfer: 'price_1U8tJtKFBTQTkmztdgtdAu8n',
  message: 'price_1U8tJuKFBTQTkmztzhIqUrg3',
};

function loadSecret() {
  const line = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('STRIPE_SECRET_KEY'));
  if (!line) throw new Error('STRIPE_SECRET_KEY not found in .env');
  return line.split('=', 2)[1].trim().replace(/^"|"$/g, '');
}

async function stripe(secret, method, path, body) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  if (!res.ok) throw new Error(`Stripe ${method} ${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const execute = process.argv.includes('--execute');
  const secret = loadSecret();

  const subs = await stripe(secret, 'GET', `/subscriptions?price=${FLAT_PRICE_ID}&status=active&limit=100`);
  if (subs.data.length === 0) {
    console.log('No active subscriptions on the flat plan — nothing to migrate.');
    return;
  }

  console.log(`Found ${subs.data.length} active subscription(s) on the flat plan.`);
  for (const sub of subs.data) {
    const flatItem = sub.items.data.find((i) => i.price.id === FLAT_PRICE_ID);
    console.log(`\nSubscription ${sub.id} (customer ${sub.customer}):`);
    console.log(`  - remove item ${flatItem.id} (flat $39/mo)`);
    console.log(`  - add items: voice (kokoro), booking, transfer, message add-ons`);

    if (!execute) continue;

    await stripe(secret, 'POST', `/subscriptions/${sub.id}`, {
      'items[0][id]': flatItem.id,
      'items[0][deleted]': 'true',
      'items[1][price]': USAGE_PRICES.voiceKokoro,
      'items[2][price]': USAGE_PRICES.booking,
      'items[3][price]': USAGE_PRICES.transfer,
      'items[4][price]': USAGE_PRICES.message,
      proration_behavior: 'none', // usage-based going forward, not a refund/backfill of past flat-rate usage
    });
    console.log('  -> migrated.');
  }

  if (!execute) {
    console.log('\nDry run only — no changes made. Re-run with --execute to apply.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
