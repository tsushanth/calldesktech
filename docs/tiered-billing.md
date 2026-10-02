# Tiered billing: how a tiered agent is billed

Status: built, not deployed, not applied. Customer-facing prices only. Companion to `docs/pricing-tier-migration-notes.md` (the original investigation). The voice engine is a separate repo and implements the other half of the contract below.

## Prices

| Tier | Per minute | Status |
| --- | --- | --- |
| Lite | 2 cents | coming soon, cannot be published yet |
| Standard | 6 cents | live |
| Pro | 10 cents | live |

Source of truth: `src/lib/pricingTiers.ts`. Booking, transfer and message events are included in a tiered call's per-minute price; add-ons are still proposals with no amount and nothing is billed for them.

## End-to-end flow

1. **Publish.** `POST /api/agents/{id}/versions` with `tier` (also the copilot "accept suggestion" path, which carries the previous version's tier forward).
   - Unknown tier, Lite, or a non-`poc` voice engine: 400 (unchanged).
   - The tier's price env var is not set: **503** `tier_billing_not_configured`, nothing written. A tiered agent can never exist without a way to bill it.
   - `ensureTierItemForTenant(tenantId, tier)` (src/lib/stripe.ts) runs **before** anything is saved. It adds a metered subscription item for the tier's price to the tenant's Stripe subscription. It only ever adds: the legacy voice item is never removed or swapped, and `syncVoicePriceForTenant` is not called for tiered publishes. It is idempotent (an existing item means do nothing; a create that lost a race to a concurrent publish resolves to the existing item).
   - Stripe fails: **502** `tier_billing_failed`, `retryable: true`, **no version or flow saved**. Publishing again is safe. (The item is added before the save, instead of after, so a failure never leaves a saved version with no billing line, and a retry needs no cleanup. The cost is that a failed save after a successful add leaves an unused item, which bills nothing.)
   - No subscription yet (trial or not checked out): the publish succeeds and no item is added, exactly like the voice sync. When the tenant checks out, the Stripe webhook (`checkout.session.completed`) adds an item for every tier their agents already use (`ensureTierItemsInUseForTenant`); failures there are logged and do not fail the webhook.
2. **Call.** The engine serves the call with the agent version's stack and writes that version's tier to `calldesk_call_logs.tier` (migration 065). Version tier null means legacy.
3. **Metering.** For a tiered call the engine reports the call's voice seconds against the customer's subscription item whose price id equals the tier's price, and no longer reports per-event usage (booking, transfer, message) for it. Legacy calls (tier null) are reported exactly as before.
4. **Web usage job** (`/api/admin/billing/report-usage`). It now counts only legacy calls (`tier` null) for the legacy voice and per-event meters, so a tiered call is never billed a second time at the legacy rate. This is the only change to legacy metering and it is a no-op while no call has a tier.
5. **Invoice.** Stripe bills each metered line at its own price: the legacy voice line at the account's flat voice rate, each tier line at that tier's rate. The billing page shows "Voice Minutes by Tier" for the current period (minutes and charge per tier; calls with no tier are labelled "Standard rate (legacy)" because they bill at the account's flat voice price, which is not necessarily the Standard tier price). The upcoming invoice on that page remains the authoritative total.

## Contract with the engine

- `calldesk_agent_versions.tier` text nullable, `'lite' | 'standard' | 'pro'` (migration 064).
- `calldesk_call_logs.tier` text nullable, written by the engine (migration 065).
- Price ids: env vars `STRIPE_TIER_LITE_PRICE`, `STRIPE_TIER_STANDARD_PRICE`, `STRIPE_TIER_PRO_PRICE`. Each is a metered, meter-backed, per-voice-**second** price (`unit_amount_decimal` = per-minute cents / 60), the same unit as the legacy voice prices: usage is reported in whole seconds.
- **Open point for the engine team: meters.** The legacy voice prices all hang off one meter (`calldesktech_voice_seconds`), and a subscription cannot hold two prices on one meter, so the tier prices get their own meters. The script creates `calldesktech_voice_seconds_lite`, `_standard` and `_pro`, with the same settings as the legacy meter (sum, customer mapping by `stripe_customer_id`, value in the `value` payload key). Tiered seconds must be reported to that tier's event name, not the legacy one. If the engine instead meters by subscription item or another event name, change `meterEventName` in the script before running it.

## Environment variables

| Variable | Where | Meaning |
| --- | --- | --- |
| `STRIPE_TIER_LITE_PRICE` | web app, engine | Lite price id (leave unset until Lite opens) |
| `STRIPE_TIER_STANDARD_PRICE` | web app, engine | Standard price id |
| `STRIPE_TIER_PRO_PRICE` | web app, engine | Pro price id |

Unset or blank means billing for that tier is not available: the web app returns 503 on publish.

## Turning it on safely

1. Review the dry run: `node scripts/stripe-create-tier-prices.mjs` (default, sends nothing). It prints the exact product, meter and price requests. Then, with `STRIPE_SECRET_KEY` set, `--live` creates them (fixed idempotency keys make a repeat safe) and prints the three env lines. Prices and meters are hard to change afterwards, so check the dry run against the legacy prices in the Dashboard (monthly, metered, per-unit, per-second) first.
2. Apply migrations `064_agent_version_tier.sql` and `065_call_log_tier.sql` (both additive, nullable columns). Apply them **before** deploying either side. The web code tolerates a missing `calldesk_call_logs.tier` column by treating every call as legacy, but the engine cannot write it until it exists.
3. Set the three env vars on the engine and on the web app.
4. Deploy the **engine first**: it must be able to meter tiered calls before any tiered version exists. With no tiered versions, it behaves as today.
5. Deploy the **web app second**. Until it is deployed no tiered version can be published through it, so nothing tiered can exist before the engine is ready.
6. Verify with one test tenant: publish a Standard version, confirm the subscription gained the Standard item and the legacy voice item is unchanged, place a short call, confirm `calldesk_call_logs.tier = 'standard'`, one usage event on the Standard meter and none on the legacy meters, and that the billing page shows the minutes under Standard.

The pricing page and tier picker advertise the tiers regardless of billing; do not deploy the web app until step 3 is done for Standard and Pro, or publishes will return 503.

## Rollback

- Web: redeploy the previous build. Tiered versions already published keep their tier; the previous web build ignores it (and would no longer exclude them from the legacy meters, so also stop publishing tiered versions before rolling back, or run the engine without tier writes).
- Engine: redeploy the previous build. Calls stop carrying a tier and bill as legacy.
- Fastest kill switch for new tiered publishes: unset the tier's env var on the web app (publishes return 503). Existing tiered agents keep running and being billed because the engine still has the price id.
- Stripe: the added subscription items are metered with no fixed fee; an unused one bills nothing and can be removed in the Dashboard. Do not delete a meter or price that has reported usage this period.
- Migrations are additive nullable columns and can stay in place.

## Existing customers

Nothing changes. Agents and subscriptions without a tier have `tier` null, are billed on the same legacy voice and event prices, and are metered the same way. The web usage job counts the same calls it did before (no call has a tier). The only visible difference is on the billing page, where their minutes show on one "Standard rate (legacy)" row, and only after migration 065.

## Known limits and risks

- Not verified against live Stripe: the shape of the legacy prices (per second vs divided quantity) could not be read from the repo, so the tier prices assume per-second `unit_amount_decimal`. The billing page reads the legacy rate from the subscription item (handles `transform_quantity`), and shows minutes only if it cannot.
- The engine's own live metering (`stripeMeter.js`) was not read. If it also reports every call's seconds to the legacy meter, a tiered call would be double billed; confirm before enabling.
- Whether adding a second metered item to a subscription that already has a legacy voice item is accepted depends on the meters being distinct (see the open point above).
- Billing is account-level: one subscription is shared by every workspace of a user, so one tier item serves all of them.
- Existing `proration_behavior: 'none'` is used when adding the item; metered items have no up-front charge, so this only prevents a surprise line.
