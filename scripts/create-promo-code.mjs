#!/usr/bin/env node
// Generates a real, single-use Stripe promotion code for the manual
// "reach out to a signup and offer them a code" outreach flow — replaces
// the old SUSH/BETA/EARLY hardcoded bypass (a shared, guessable, unmetered
// giveaway sitting in the shipped client JS with zero Stripe involvement,
// found and removed 2026-09-24).
//
// A code from this script still requires the recipient to enter a real
// card at Stripe checkout (allow_promotion_codes is on) — it discounts
// their first invoice by $10, once, then bills normally. max_redemptions=1
// so it can't be reused or shared beyond the one person you sent it to.
//
// Usage:
//   node scripts/create-promo-code.mjs                       # $10 off, no custom code, no expiry
//   node scripts/create-promo-code.mjs --code WELCOME-TELVIA  # custom code text
//   node scripts/create-promo-code.mjs --expires-days 30      # code expires in 30 days
//   node scripts/create-promo-code.mjs --amount 20            # $20 off instead of $10

import { readFileSync } from 'node:fs';

const COUPON_ID = 'outreach-signup-credit';

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
  const json = await res.json();
  if (!res.ok) throw new Error(`Stripe ${method} ${path} -> HTTP ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };
  return {
    code: get('--code'),
    expiresDays: get('--expires-days') ? Number(get('--expires-days')) : undefined,
    amountDollars: get('--amount') ? Number(get('--amount')) : 10,
  };
}

async function ensureCoupon(secret, amountDollars) {
  const couponId = amountDollars === 10 ? COUPON_ID : `${COUPON_ID}-${amountDollars}`;
  try {
    const existing = await stripe(secret, 'GET', `/coupons/${couponId}`);
    return existing.id;
  } catch {
    // Doesn't exist yet — create it. duration=once means it only discounts
    // the FIRST invoice, not every invoice forever, so exposure per
    // recipient is bounded to roughly one billing cycle.
    const created = await stripe(secret, 'POST', '/coupons', {
      id: couponId,
      amount_off: String(amountDollars * 100),
      currency: 'usd',
      duration: 'once',
      name: `$${amountDollars} signup credit (outreach)`,
    });
    return created.id;
  }
}

async function main() {
  const { code, expiresDays, amountDollars } = parseArgs();
  const secret = loadSecret();

  const couponId = await ensureCoupon(secret, amountDollars);

  const body = {
    coupon: couponId,
    max_redemptions: '1',
  };
  if (code) body.code = code.toUpperCase();
  if (expiresDays) body.expires_at = String(Math.floor(Date.now() / 1000) + expiresDays * 86400);

  const promo = await stripe(secret, 'POST', '/promotion_codes', body);

  console.log(`Created promotion code: ${promo.code}`);
  console.log(`  $${amountDollars} off the first invoice, single-use (max_redemptions=1)`);
  if (expiresDays) console.log(`  Expires in ${expiresDays} day(s)`);
  console.log(`\nGive this code directly to the person you're reaching out to — they enter it on the Stripe checkout page (a card is still required, this just discounts their first invoice).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
