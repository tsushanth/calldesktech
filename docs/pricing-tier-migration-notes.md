# Pricing tiers: what must change to bill by tier

> Update: the billing work described below is implemented on the `tiered-billing` branch; see docs/tiered-billing.md. This file is kept as the original investigation.

Status: investigation notes for the owner. Customer-facing prices only; no provider costs or margins belong in this file. Nothing here is deployed, applied or verified live. Written from a read-only pass over this repo; the metering side that lives in the voice engine repo (`call-loop-poc`, `stripeMeter.js`) was not read and is marked "unverified" where it matters.

## What the tier layer does today (this branch)

- `src/lib/pricingTiers.ts` is the single source of truth for Lite 2c, Standard 6c, Pro 10c per minute and the proposed add-ons.
- Publishing a version with `tier` records the tier on the version row and derives the language model and voice from it. Nothing is billed differently: **no Stripe price, meter, table or invoice line knows about tiers yet.**
- A version published with a tier deliberately skips `syncVoicePriceForTenant`, because that function would swap the subscription's voice price to the legacy rate of the tier's voice backend (for Standard that is the $0.12 ElevenLabs line, double the advertised 6c). The subscription's voice price simply stays as it was.
- Net effect until the work below is done: the pricing page and tier picker advertised prices that no invoice reflects (superseded by docs/tiered-billing.md, which wires billing). Do not deploy the pricing page or the picker before billing is wired, or customers will be shown 6c and billed whatever their subscription already says.

## How usage is billed today

1. Checkout (`src/app/api/checkout/route.ts`) creates a Stripe subscription with four metered prices (`USAGE_PRICES` in `src/lib/constants.ts`): one voice price (always the default-voice one at first), plus per-event prices for bookings, transfers and messages.
2. The voice price is **per subscription, not per agent or per call**. When a `poc` version is published with a `ttsBackend`, `syncVoicePriceForTenant` (`src/lib/stripe.ts`) swaps the subscription's voice line item to that backend's price ($0.10 default voice, $0.12 ElevenLabs or Cartesia, $0.16 MiniMax). The last version published wins for the whole account.
3. Billing is account-level (migration 018 and the Stripe webhook): one subscription per user, mirrored onto every workspace the user owns, so one price applies across all of a user's workspaces and agents.
4. Usage is reported as Stripe Billing Meter events. `src/lib/reportUsageToStripe.ts` (job at `POST /api/admin/billing/report-usage`) sums `calldesk_call_logs.duration_seconds` per tenant since `calldesk_tenants.last_usage_reported_at` and sends **one** voice-seconds meter event (`calldesktech_voice_seconds`), plus booking, transfer and message counts. The four voice prices all hang off that single meter, which is why only one can be attached at a time.
5. `calldesk_call_logs` has no agent version, tier, voice backend or price column in the migrations in this repo, so nothing in the database says which tier a call ran on. (Unverified: the voice engine may write extra columns not covered by these migrations, and it separately meters live calls through its own `stripeMeter.js`.)
6. The billing page (`src/app/api/tenants/[id]/billing/route.ts`) reads the upcoming invoice from Stripe and sums minutes from call logs; it does not know about tiers.

## What has to change to bill by tier

Database (draft migration `supabase/migrations/064_agent_version_tier.sql`, not applied; numbered 064 because 063 is already used twice):

- `calldesk_agent_versions.tier` and `tier_overrides` (drafted).
- A way to attribute each call to a tier: add the agent version id (or the tier and carrier mode) to `calldesk_call_logs`, written at call start by the voice engine. Without it the usage job cannot split minutes by tier. The agent version row cannot be joined reliably after the fact if a number is re-routed mid-period.
- Decide where a tier lives when one account runs agents on different tiers (see "Per account or per agent" below).

Stripe:

- New metered prices on a per-minute basis for each purchasable tier: Standard 6c and Pro 10c now, Lite 2c when it opens. Prices are immutable in Stripe, so any later change is a new price.
- Either one meter per tier, or one meter with a tier dimension (Stripe meters support dimensions; confirm the meter's `dimension_payload_keys` before relying on it). The current voice meter is seconds-based, so keep the unit.
- Per-tier prices need checkout and the subscription to hold more than one voice line at the same time if one account can run more than one tier. Today the code assumes exactly one voice line and swaps it.
- Add-on prices and meters (or flat line items) once the owner sets amounts. All four add-ons are placeholders (`proposed: true`, no amount), and nothing is billed for them now.
- Carrier: Lite and Standard are "bring your own carrier", Pro includes phone service. The existing platform sells phone numbers and has no way to connect a customer's own carrier (SIP trunking is listed as "not yet" in `src/lib/compareData.ts`; the numbers route only records a "ported" number that has to forward to one of ours). **Standard and Lite cannot honestly be sold as engine-only until a bring-your-own-carrier path exists**, otherwise those calls still run over our phone service at a price that does not cover it.

Code:

- `src/lib/stripe.ts` `syncVoicePriceForTenant`: replace the single swap with a per-tier model, or remove it for tiered accounts.
- `src/lib/reportUsageToStripe.ts` and `src/lib/usage.ts`: group seconds by tier (and report each to its meter); keep the legacy voice meter for untiered calls.
- `src/app/api/checkout/route.ts`: line items are hard-coded to the default-voice price plus the three event prices. Decide the new-customer default (a tier) and whether the per-event prices stay.
- `src/app/api/tenants/[id]/billing/route.ts` and the dashboard billing page: show plan by tier.
- `src/app/pricing/page.tsx`: the Get Started button still starts the unchanged checkout. Per-tier buttons need the checkout change above.
- The voice engine (`call-loop-poc`, other repo, unverified): needs the tier or version on each call's usage record and to honour BYO carrier calls. Its `stripeMeter.js` may meter live minutes independently of the job above; confirm there is no double reporting before changing either side.
- Other paths that create versions: the simple-agent settings page, onboarding, template install and the trial creator all call the versions API without a tier, so they create untiered versions and still run the legacy voice price sync. The copilot "accept suggestion" path now carries the previous tier and models forward (changed on this branch); the others have not been touched.

Environment: new Stripe price ids and meter names (a `USAGE_PRICES`-style constant per tier, kept in code like the current ones, or env vars if the owner prefers not to commit ids). No new secrets are implied. If a feature flag is wanted to gate tier checkout, it would be a new env var; none was added.

## Per account or per agent

The current model is one voice price per subscription, applied to the whole account. Tiers are chosen per agent version. The owner needs to pick one:

1. **Per agent, metered by tier** (what the picker implies): usage splits by the tier of the version that took the call. Needs the call-level attribution and multi-line subscriptions above. Most flexible, most work.
2. **Per account**: one tier for the whole account, set at checkout or in billing, and every agent runs on it. Simple to bill, but contradicts the per-version picker.

## What would break for existing customers

- Nothing changes for an existing agent or subscription if the tier fields are simply left unused: untiered publishes behave as before, and the new database columns are only written when a tier is chosen, so the code keeps working on a database where the migration has not been applied.
- If an existing customer picks a tier before billing is wired: they are shown the tier price but billed their current voice price, because tiered publishes skip the voice price sync. If instead the sync were not skipped, picking Standard would raise their per-minute price from 10c to 12c.
- If `syncVoicePriceForTenant` were extended naively to tiers: the last version published (by any agent, by any workspace of the account) would reprice every call on the account.
- Re-pricing in place is not possible: Stripe prices are immutable, so existing subscriptions would need an item swap per customer, with proration decisions. Existing flat-price customers should be left where they are unless they opt in.
- Re-publishing an existing agent from a path that does not carry the tier (settings page, onboarding, template install) silently drops the tier and re-syncs the legacy voice price.
- Invoices and the billing page for tiered accounts would show lines the current page does not expect.
- The usage job's first-run rule (it only sets a baseline for tenants that have never reported, to avoid back-billing) should be kept for any new meter, or the first run could bill months of history at once.
- Lite: live at 2 cents on the lowest-cost voice (Piper). Publishing it needs acceptLowerQuality: true (UI checkbox or API field); carry-over of an existing Lite version keeps that acceptance. Its metered price is STRIPE_TIER_LITE_PRICE.

## Customer-facing places that still describe the flat price (not rewritten; owner's wording decision)

- `src/lib/compareData.ts`: every competitor page that says "$0.10 flat" or "all-in" (lines 56 to 59, 64, 83, 88, 107, 112, 135, 158, 176, 181, 199, 204, 222, 227, 244, 249, 268, 272 to 273, 290, 294 to 295, 311, 316).
- `src/app/compare/page.tsx` (lines 25 to 26, "$0.10 per minute, flat").
- `src/app/compare/retell/page.tsx` (lines 32, 59).
- `src/app/partners/page.tsx` (lines 19 to 20: "Customer pays $0.10 per minute", partner earns $0.02).
- `src/app/dashboard/settings/page.tsx` (line 517 "$0.16/min" on the MiniMax option; the settings page also publishes versions with a voice backend and no tier).
- `src/lib/deck/investorSlides.ts` and `src/lib/deck/slides.ts` (price bars and "a simple offer").
- `src/components/onboarding/PricingCard.tsx`: no longer used by the pricing page; still describes the $0.10 plan and the per-action fees.
- Per-action fees (booking, transfer, message) are not part of the tier layout; whether they continue is an owner decision.

## Pre-existing items in this public repo the owner should look at

These were found while reading, are not changed by this branch, and are outside the "customer-facing price only" rule: internal cost figures and margins appear in `src/lib/constants.ts` comments, `src/lib/costEstimate.ts`, `src/lib/deck/investorSlides.ts` (margin figures), `src/app/compare/retell/page.tsx` (a per-minute figure for our own cost), the "Cost" row in the dashboard agent builder, and the provider price columns on the public docs page (model catalog). They are listed here, without repeating the numbers, so the owner can decide whether to move them to the private repo.
