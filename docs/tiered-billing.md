# Tiered billing: how a tiered agent is billed

Status: built, not deployed, not applied. Customer-facing prices only. Companion to `docs/pricing-tier-migration-notes.md` (the original investigation). The voice engine is a separate repo and implements the other half of the contract below.

## Prices

| Tier | Per minute | Status |
| --- | --- | --- |
| Lite | 2 cents | live; lowest-cost voice (Piper), publish needs acceptLowerQuality: true |
| Standard | 5 cents | live |
| Pro | 9 cents | live |

The tier is the engine only (Lite: Piper voice; Standard: Gemini 3.1 Flash-Lite with ElevenLabs Flash; Pro: Claude Sonnet 4.6 with ElevenLabs v4 Turbo). Every tier is bring-your-own carrier; phone numbers from us are a paid extra on every plan (see the add-on section). Source of truth: `src/lib/pricingTiers.ts` (stacks use the named constants in `src/lib/modelCatalog.ts`). Booking, transfer and message events are included in a tiered call's per-minute price; add-ons are still proposals with no amount and nothing is billed for them.

## End-to-end flow

1. **Publish.** `POST /api/agents/{id}/versions` with `tier` (also the copilot "accept suggestion" path, which carries the previous version's tier forward).
   - Unknown tier, Lite, or a non-`poc` voice engine: 400 (unchanged).
   - The tier's price env var is not set: **503** `tier_billing_not_configured`, nothing written. A tiered agent can never exist without a way to bill it.
   - `ensureTierItemForTenant(tenantId, tier)` (src/lib/stripe.ts) runs **before** anything is saved. It adds a metered subscription item for the tier's price to the tenant's Stripe subscription. It only ever adds: the legacy voice item is never removed or swapped, and `syncVoicePriceForTenant` is not called for tiered publishes. It is idempotent (an existing item means do nothing; a create that lost a race to a concurrent publish resolves to the existing item).
   - Stripe fails: **502** `tier_billing_failed`, `retryable: true`, **no version or flow saved**. Publishing again is safe. (The item is added before the save, instead of after, so a failure never leaves a saved version with no billing line, and a retry needs no cleanup. The cost is that a failed save after a successful add leaves an unused item, which bills nothing.)
   - No subscription yet (trial or not checked out): the publish succeeds and no item is added, exactly like the voice sync. When the tenant checks out, the Stripe webhook (`checkout.session.completed`) adds an item for every tier their agents already use (`ensureTierItemsInUseForTenant`); failures there are logged and do not fail the webhook.
2. **Call.** The engine serves the call with the agent version's stack and writes that version's tier to `calldesk_call_logs.tier` (migration 065). Version tier null means legacy.
3. **Metering is done by the daily cron, not the engine.** The engine only writes `tier` onto `calldesk_call_logs`. The cron (`.github/workflows/report-usage-daily.yml` calling `POST /api/admin/billing/report-usage`, code in `src/lib/reportUsageToStripe.ts`) reads each tenant's calls in the window `[last_usage_reported_at, now floored to the minute)` and splits them so every call is counted exactly once:
   - tier null, or a tier id this code does not know: the legacy meters, exactly as before (`calldesktech_voice_seconds` plus booking, transfer and message event counts);
   - a known tier: that tier's voice seconds go to `calldesktech_voice_seconds_lite`, `_standard` or `_pro`. Booking, transfer and message events of tiered calls are not reported (they are included in the per-minute price).
   Each event uses the same payload as the legacy meters (`stripe_customer_id`, `value` in whole seconds) and the same idempotency approach: identifier `usage-report:{tenant}:{dimension}:{since}_{until}`, where the dimension is `voice` for legacy and `voice_{tier}` for a tier. A re-run in the same minute therefore derives identical identifiers and Stripe drops the duplicates.
4. **Failure behaviour.** If a tier has calls in the window but its price env var is not set, the tenant's report returns `status: error` before sending anything, and `last_usage_reported_at` is not advanced, so the next run retries the whole window (loud, never a silent skip). The watermark also advances only when every event succeeded, as before. Baseline initialisation for a tenant that has never reported is unchanged. A tenant with only legacy usage sends exactly the events it sent before.
5. **Invoice.** Stripe bills each metered line at its own price: the legacy voice line at the account's flat voice rate, each tier line at that tier's rate. The billing page shows "Voice Minutes by Tier" for the current period (minutes and charge per tier; calls with no tier are labelled "Standard rate (legacy)" because they bill at the account's flat voice price, which is not necessarily the Standard tier price). The upcoming invoice on that page remains the authoritative total.

## Contract with the engine

- `calldesk_agent_versions.tier` text nullable, `'lite' | 'standard' | 'pro'` (migration 064).
- `calldesk_call_logs.tier` text nullable, written by the engine (migration 065).
- Price ids: env vars `STRIPE_TIER_LITE_PRICE`, `STRIPE_TIER_STANDARD_PRICE`, `STRIPE_TIER_PRO_PRICE`. Each is a metered, meter-backed, per-voice-**second** price (`unit_amount_decimal` = per-minute cents / 60), the same unit as the legacy voice prices: usage is reported in whole seconds.
- **Meters.** The legacy voice prices all hang off one meter (`calldesktech_voice_seconds`), and a subscription cannot hold two prices on one meter, so each tier price is attached to its own meter, created by the script: `calldesktech_voice_seconds_lite`, `_standard`, `_pro`, with the same settings as the legacy meter (sum, customer mapping by `stripe_customer_id`, value in the `value` payload key). The cron reports to them (above); the engine does not report usage and its legacy usage-records path is not used for these prices.

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
3. Set the three env vars on the web app (which runs the cron) and, if the engine reads them, on the engine.
4. Deploy the **engine first**: it must write `calldesk_call_logs.tier` before any tiered version exists. With no tiered versions it behaves as today.
5. Deploy the **web app second** (it carries the cron's tier reporting). Until it is deployed no tiered version can be published, so nothing tiered can exist before both halves are ready. Do not deploy the web app before the engine writes `tier`: a tiered call with no `tier` would be billed at the legacy rate.
6. Verify with one test tenant: publish a Standard version, confirm the subscription gained the Standard item and the legacy voice item is unchanged, place a short call, confirm `calldesk_call_logs.tier = 'standard'`, run the cron, and check the report as below.

### Verifying a day's report in Stripe

The cron's JSON response lists, per tenant, `recorded: [{dimension, eventName, value, identifier}]` and the window. In the Stripe Dashboard open Billing, Meters, pick `calldesktech_voice_seconds_standard` (or the tier), and look up the customer: the event for the window should equal the sum of `duration_seconds` of that tenant's `tier = 'standard'` calls in `[since, until)`. The legacy meter's event for the same window should equal the sum of the tenant's tier-null calls only. Across all voice meters the seconds must add up to the window's total call seconds. The customer's upcoming invoice should show a line per tier price at the tier rate.

The pricing page and tier picker advertise the tiers regardless of billing; do not deploy the web app until step 3 is done for Standard and Pro, or publishes will return 503.

## Grandfathering: existing subscriptions keep their price

Stripe prices are immutable, so a repricing is a new price. A subscription keeps billing at the price its tier item was created with, and nothing in the code swaps an existing item to a new price.

- **Script.** `scripts/stripe-create-tier-prices.mjs --live` looks up the existing product (by name), meters (by event name) and prices (by metadata `tier`, `cents_per_minute`, `unit`) and reuses them; it only creates prices that do not exist (today Standard at 5 cents and Pro at 9 cents, on the existing per-tier meters) and never updates or archives anything. Idempotency keys include the cents, so a repricing is not blocked by an earlier run. After it runs, set `STRIPE_TIER_STANDARD_PRICE` and `STRIPE_TIER_PRO_PRICE` to the new price ids; `STRIPE_TIER_LITE_PRICE` is unchanged.
- **New items.** `ensureTierItemForTenant` adds an item at the env price only when the subscription has no item for that tier. A tenant that already has an item for the tier at any price (recognised by the current env price id, or by the `tier` + `unit=voice_seconds` metadata the script stamps on every tier price) gets `already_present` and is left alone. (Before this change the lookup matched only the env price id, so a tenant on the old price would have been sent to Stripe for a second item on the same meter, which Stripe rejects: the publish would have failed with `tier_billing_failed` rather than silently repricing. It now succeeds and keeps the old price.)
- **Display.** The billing page's per-tier rows use the cents per minute read from the tenant's own tier item (`tierRatesFromItems`) and fall back to the catalog price only for a tier the tenant has no item for. The upcoming invoice (from Stripe) was always authoritative. The agent builder's "List price" is the catalog price for new items.
- **Usage reporting** is unchanged: seconds go to the tier's meter, and Stripe applies whichever price is on the tenant's item.
- **Moving a tenant to the new price** is a deliberate manual step (swap the item in the Stripe Dashboard); the app never does it.
- **Not covered.** A tier price created by hand without the metadata and different from the env price is not recognised as the tenant's tier item; create tier prices only with the script.

## Rollback

- Web: redeploy the previous build. The previous cron bills every call at the legacy rate, so before rolling back, stop the engine writing `tier` (or accept that tiered calls in the window bill as legacy).
- Engine: redeploy the previous build. Calls stop carrying a tier and bill as legacy.
- Fastest kill switch for new tiered publishes: unset the tier's env var on the web app (publishes return 503). Existing tiered agents keep running and being billed because the engine still has the price id.
- Stripe: the added subscription items are metered with no fixed fee; an unused one bills nothing and can be removed in the Dashboard. Do not delete a meter or price that has reported usage this period.
- Migrations are additive nullable columns and can stay in place.

## Existing customers

Nothing changes. Agents and subscriptions without a tier have `tier` null, are billed on the same legacy voice and event prices, and are metered the same way. The web usage job counts the same calls it did before (no call has a tier). The only visible difference is on the billing page, where their minutes show on one "Standard rate (legacy)" row, and only after migration 065.

## Known limits and risks

- Not verified against live Stripe: the shape of the legacy prices (per second vs divided quantity) could not be read from the repo, so the tier prices assume per-second `unit_amount_decimal`. The billing page reads the legacy rate from the subscription item (handles `transform_quantity`), and shows minutes only if it cannot.
- The engine's own live metering (`stripeMeter.js`) was not read. If it also reports a call's seconds to any meter, a tiered call could be double billed; the engine must only write `tier` on the call log.
- Whether adding a second metered item to a subscription that already has a legacy voice item is accepted depends on the meters being distinct (see Meters above).
- Billing is account-level: one subscription is shared by every workspace of a user, so one tier item serves all of them.
- Existing `proration_behavior: 'none'` is used when adding the item; metered items have no up-front charge, so this only prevents a surprise line.

## Phone numbers add-on (Twilio premium and Telnyx value carriers)

Status: built, not deployed, not applied. Customer-facing prices only. Code: `src/lib/numberAddOn.ts` (config), `src/lib/numberAddOnBilling.ts` (Stripe and database side).

**Product.** Customers on every tier (all are bring-your-own carrier) may buy a phone number from us; bringing your own number or carrier is free: $2.00 per month per number plus 1.5 cents per minute of INBOUND calls to those numbers (the Twilio carrier surcharge, on top of the plan's per-minute price). Outbound stays bring-your-own carrier and is neither provided nor billed. Pro pays the add-on like every other tier; only legacy flat-rate tenants keep numbers included (see Who pays). The design is per carrier (`carrier` column, `NUMBER_ADDON_PRICES`, `NUMBER_PRICE_ENV`, `NUMBER_INBOUND_METER_EVENT`), and Telnyx is a second carrier entry: $1.00 per month per number plus 1 cent per inbound minute, on its own Stripe prices and meter. The customer picks the carrier at purchase (`carrier: 'telnyx'`); each carrier's billed count and quantity are independent. `NUMBER_ADDON_TIERS` (currently Lite, Standard, Pro) is the one constant that decides which tiers pay.

**Who pays.** `numberPlanForTiers` looks at the latest version of each of the tenant's agents and at the tenant's creation date: any Lite, Standard or Pro agent means add-on (no tenant was on Pro when this changed, so nothing is grandfathered); with no tiered agent the number is included ONLY for a genuine legacy flat-rate tenant, meaning every agent version is untiered AND the tenant was created before the tiers launched (`TIERS_LAUNCHED_AT` in `numberAddOn.ts`, 2026-10-02 00:00 UTC, the day of the commit and production migration that introduced tiers: those customers signed up under the flat per-minute price that includes phone service, so charging them would be a repricing). Every other tenant with no tiered agent, including a brand-new one with no agents at all, pays the add-on and must accept the terms; it also still needs a payment method and a subscription. A missing creation date counts as not legacy. `NUMBER_ADDON_TIERS` semantics are unchanged.

**Purchase** (`POST /api/tenants/{id}/phone-numbers/purchase`). Add-on tenants must send `acceptNumberAddOn: true`, otherwise 400 `number_addon_acceptance_required` with the terms. The route then (1) fails closed with 503 `number_addon_not_configured` if the Stripe price env vars are missing, (2) attaches the Stripe items to the subscription BEFORE buying (monthly item quantity set to billed numbers + 1, metered inbound item added once), (3) buys the number through the engine, rolling the Stripe change back if that fails, (4) records the row with `addon_billed = true`, then settles the quantity from the database count (so two simultaneous purchases converge). Quantities are always set to an absolute count, never incremented, which makes retries safe. No subscription: 402 with action `checkout`. Stripe failure: 502 `number_addon_billing_failed`, nothing bought.

**Release** (`DELETE /api/phone-numbers/{id}`). A purchased number is released on the carrier through the engine endpoint `POST /release-number` (does not exist in call-loop-poc yet; until it does the route answers 501 and changes nothing, so billing does not stop while we still hold the number), the row is deleted, and the monthly quantity is set to the remaining billed count (both items are removed at zero). Ported numbers are only unregistered.

**Usage.** The daily cron (`reportTenantUsageToStripe`) adds a dimension `number_inbound_twilio` on meter event `calldesktech_number_inbound_seconds_twilio`: whole seconds of calls with `direction = 'inbound'` whose `to_number` is one of the tenant's `addon_billed` purchased numbers on that carrier, excluding `is_internal_test` calls and tenants whose plan resolves to included (legacy flat-rate). It is separate from the voice meters, so a call is billed its voice minutes there and its inbound surcharge here, each once. Same identifier format and watermark as the other dimensions. If billed numbers had inbound calls and the inbound price env var is unset, the tenant's report errors and the watermark does not advance.

**Environment variables.** Per carrier: `STRIPE_PRICE_NUMBER_<CARRIER>_MONTHLY` (licensed monthly price, quantity = numbers) and `STRIPE_PRICE_NUMBER_<CARRIER>_INBOUND` (metered price on meter `calldesktech_number_inbound_seconds_<carrier>`, whole seconds, customer mapped by `stripe_customer_id`), with CARRIER = TWILIO or TELNYX. The Telnyx Stripe product, prices and meter do not exist yet; until the env vars are set, buying on Telnyx answers 503 and nothing is bought. Apply migrations `069_phone_number_addon_billed.sql` and `070_phone_number_release_after.sql` before deploying.

**Cancellation.** On `customer.subscription.deleted` the Stripe webhook sets `calldesk_phone_numbers.release_after` = now + 14 days (`RELEASE_GRACE_DAYS`) on every number with `source = 'purchased'` of the tenants on that subscription (an existing date is never extended; numbers the customer brought are never touched). `customer.subscription.updated` with status active or trialing, and `checkout.session.completed`, clear it. The Phone Numbers page shows "This number will be released on <date> unless you resubscribe". A daily job (`POST /api/cron/release-numbers`, `Authorization: Bearer CRON_SECRET`, `?dry=1` for a dry run; `.github/workflows/release-numbers-daily.yml`, repo secret `RELEASE_NUMBERS_URL`, does nothing when unset) releases numbers past `release_after`: it re-checks the tenant has no live subscription (active, trialing or past_due keeps the number and clears the date), calls the engine `POST /release-number` (a 404 with an error body means already released and counts as done; a 404 without one means the engine lacks the route and the row is kept), deletes the row, sets the Stripe add-on quantity to the remaining billed count if the subscription still exists, and writes a `number.release` row to `calldesk_audit_log`. At most 25 numbers per run; a failed release leaves the row for the next run. Apply migration `070_phone_number_release_after.sql` before deploying.

**Known gaps.** No hook removes numbers when a tenant is deleted (no tenant delete exists). Removing the metered item at zero can drop up to a day of unreported inbound seconds from calls just before the release.
