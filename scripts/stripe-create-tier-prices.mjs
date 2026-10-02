#!/usr/bin/env node
// Creates the Stripe objects behind the pricing tiers (src/lib/pricingTiers.ts, docs/tiered-billing.md):
//   - one product ("CallDeskTech Voice Tiers")
//   - one billing meter per tier (a subscription cannot hold two prices on one meter, and the legacy voice meter already carries the
//     account's legacy voice price, so each tier meters on its own event name)
//   - one metered, per-voice-second price per tier at 2, 6 and 10 cents per minute
//
// Same shape as the legacy voice prices (see src/lib/constants.ts and src/lib/reportUsageToStripe.ts): meter-backed metered price,
// usage reported in whole SECONDS, so unit_amount_decimal is the per-minute rate divided by 60, billing_scheme per_unit, monthly interval.
// aggregate_usage is a legacy-metering field and is not used with meter-backed prices; the meter sums the reported values instead.
//
// DRY RUN BY DEFAULT: prints the exact requests it would send and touches nothing (it does not even read the Stripe key).
// Pass --live to execute; then STRIPE_SECRET_KEY must be set in the environment. Prices and meters cannot be edited or deleted
// freely in Stripe, so read the dry run first. Running --live twice is safe: every request carries a fixed idempotency key, so a
// repeat within Stripe's key window returns the same objects instead of creating duplicates; after that window, check the Dashboard first.
//
//   node scripts/stripe-create-tier-prices.mjs          # dry run
//   node scripts/stripe-create-tier-prices.mjs --live   # create for real, then print env lines

const LIVE = process.argv.includes('--live');
const VERSION = 'v1';

// Customer-facing per-minute prices in cents, matching PRICING_TIERS in src/lib/pricingTiers.ts (a test keeps them in step).
export const TIER_PRICES = [
  { tier: 'lite', cents: 2, env: 'STRIPE_TIER_LITE_PRICE' },
  { tier: 'standard', cents: 6, env: 'STRIPE_TIER_STANDARD_PRICE' },
  { tier: 'pro', cents: 10, env: 'STRIPE_TIER_PRO_PRICE' },
];

const TIER_NAMES = { lite: 'Lite', standard: 'Standard', pro: 'Pro' };

/** Cents per voice second as a decimal string Stripe accepts (up to 12 decimal places). */
export function centsPerSecond(centsPerMinute) {
  return String(Number((centsPerMinute / 60).toFixed(10)));
}

export function meterEventName(tier) {
  return `calldesktech_voice_seconds_${tier}`;
}

/** The requests, in order, with placeholders for ids that only exist after an earlier request runs. */
export function buildRequests() {
  const reqs = [
    {
      key: 'product',
      path: '/products',
      idempotencyKey: `calldesk-tier-product-${VERSION}`,
      body: { name: 'CallDeskTech Voice Tiers', description: 'Per-minute voice agent pricing tiers.' },
    },
  ];
  for (const t of TIER_PRICES) {
    reqs.push({
      key: `meter:${t.tier}`,
      path: '/billing/meters',
      idempotencyKey: `calldesk-tier-meter-${t.tier}-${VERSION}`,
      body: {
        display_name: `Voice seconds (${TIER_NAMES[t.tier]})`,
        event_name: meterEventName(t.tier),
        'default_aggregation[formula]': 'sum',
        'customer_mapping[type]': 'by_id',
        'customer_mapping[event_payload_key]': 'stripe_customer_id',
        'value_settings[event_payload_key]': 'value',
      },
    });
  }
  for (const t of TIER_PRICES) {
    reqs.push({
      key: `price:${t.tier}`,
      path: '/prices',
      idempotencyKey: `calldesk-tier-price-${t.tier}-${VERSION}`,
      body: {
        currency: 'usd',
        product: '{product.id}',
        nickname: `${TIER_NAMES[t.tier]} voice, ${t.cents} cents per minute`,
        billing_scheme: 'per_unit',
        unit_amount_decimal: centsPerSecond(t.cents),
        'recurring[interval]': 'month',
        'recurring[usage_type]': 'metered',
        'recurring[meter]': `{meter:${t.tier}.id}`,
        'metadata[tier]': t.tier,
        'metadata[cents_per_minute]': String(t.cents),
        'metadata[unit]': 'voice_seconds',
      },
    });
  }
  return reqs;
}

function fill(body, ids) {
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = String(v).replace(/\{([^}]+)\}/g, (_, ref) => ids[ref] ?? `{${ref}}`);
  }
  return out;
}

async function post(secret, req, body) {
  const res = await fetch(`https://api.stripe.com/v1${req.path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': req.idempotencyKey,
    },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Stripe POST ${req.path} -> HTTP ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  const reqs = buildRequests();
  if (!LIVE) {
    console.log('DRY RUN: nothing is sent to Stripe. Re-run with --live to create these.\n');
    for (const r of reqs) {
      console.log(`POST https://api.stripe.com/v1${r.path}   (Idempotency-Key: ${r.idempotencyKey})`);
      for (const [k, v] of Object.entries(r.body)) console.log(`  ${k}=${v}`);
      console.log('');
    }
    console.log('After --live, the script prints these env lines (set them on the web app and the engine):');
    for (const t of TIER_PRICES) console.log(`${t.env}=<price id of the ${t.tier} price>`);
    return;
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('STRIPE_SECRET_KEY is not set in the environment (needed for --live).');
  const ids = {};
  for (const r of reqs) {
    const created = await post(secret, r, fill(r.body, ids));
    ids[`${r.key}.id`] = created.id;
    console.error(`created ${r.key}: ${created.id}`);
  }
  console.log('\n# Set these environment variables on the web app and on the engine:');
  for (const t of TIER_PRICES) console.log(`${t.env}=${ids[`price:${t.tier}.id`]}`);
  console.log('\n# Meter event names the engine reports each tier\'s seconds to:');
  for (const t of TIER_PRICES) console.log(`# ${t.tier}: ${meterEventName(t.tier)}`);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
