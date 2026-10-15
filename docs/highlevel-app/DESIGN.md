# Calldesk for HighLevel: Marketplace app (design and build plan)

Status: draft, 2026-10-15. Replaces the webhook recipe (docs/highlevel, "Tier 0") as the main way HighLevel agencies use Calldesk. The recipe stays as the no-install fallback.

## Why an app
The recipe needs an agency to paste two workflows and an API key. An app is: install from the Marketplace, link a Calldesk workspace once, then "Place a Calldesk call" shows up as a normal workflow action and "Calldesk call completed" as a normal trigger. Agencies can also resell it to their sub-accounts.

## What HighLevel gives us (from HighLevel's own docs, checked 2026-10-15)
- **OAuth 2.0 install.** Install URL comes from the app's Auth page. After consent the browser goes to our Redirect URL with `?code=`. We POST to `https://services.leadconnectorhq.com/oauth/token` (`client_id`, `client_secret`, `grant_type=authorization_code`, `code`, `user_type` = Company or Location, `redirect_uri`). Access token about 24 hours; refresh token valid up to a year and rotates on every use. Responses carry `companyId`, and for Location tokens `locationId` and `userId`. An INSTALL webhook also carries `installType`, `locationId`, `companyId`, `userId`.
- **Workflow actions.** We define name, immutable key, icon, fields (string, numeric, select, dynamic, and others) and an execution URL plus headers. HighLevel POSTs `{ data, extras: { locationId, contactId, workflowId }, meta: { key, version } }`. We return a sample JSON response shape, which becomes variables in later steps. Optional Pause Execution holds the contact until we call a resume webhook (body must include `extras`). One Dynamic field per action (we return `inputs`).
- **Workflow triggers.** We define name, key, a sample payload (used for filters and variables) and a Subscription URL. HighLevel POSTs to the Subscription URL when a workflow trigger is created, updated or deleted, with `triggerData { id, key, filters, eventType, targetUrl }` and `extras { locationId, workflowId, companyId }`. We fire the trigger by POSTing to the `targetUrl`, which looks like `https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/{locationId}/{workflowTriggerId}`. Workflows can run without a contact.
- **Review.** Each new version of an action or trigger is submitted for review and must be approved before it goes live to all sub-accounts. Marketplace workflow actions only show in sub-accounts that have the app installed.
- **Money.** Marketplace apps can be free, subscription, one-time or freemium, with trials, usage-based pricing and agency rebilling, paid out monthly through Tipalti. HighLevel's help pages disagree on whether a commission applies: confirm in the developer agreement. Separately, LC Premium workflow actions and triggers cost the agency a small fee per execution on the HighLevel side.

## Not documented (must be tested in a real sub-account)
- Authentication on the trigger `targetUrl` (the trigger docs do not say).
- Timeouts and retries for action execution.
- Whether review of a private (non-public) app is needed for our own agency.
- The exact shape of the Dynamic field response.

## Design
### Modules
1. **Install.** `GET /api/highlevel/oauth/callback`: exchange the code, store the install, redirect to the link page.
2. **Link.** `GET /highlevel/link?location=...`: a signed-in Calldesk owner picks a workspace (or creates one) and we store `tenant_id` on the install. Own billing: the workspace is the paying account (existing Stripe subscription). Nothing is billed through HighLevel.
3. **Action "Place a Calldesk call".** Fields: phone (default `{{contact.phone}}`), agent or number (Dynamic), variables (key/value, default contact first name). `POST /api/highlevel/actions/place-call` places the call through the same code path as `POST /api/phone-numbers/{id}/call` and returns `{ call_sid, status }`.
4. **Dynamic field.** `POST /api/highlevel/actions/options` returns the linked workspace's outbound-capable numbers and agents.
5. **Trigger "Calldesk call completed".** Subscription URL `POST /api/highlevel/triggers/subscription` stores `targetUrl` per location. When a call finishes for a linked workspace, a dispatcher POSTs the flat payload (phone, name, outcome, summary, duration_seconds, transcript_url, var_*) to each active `targetUrl`. Filters: outcome, agent.
6. **Lifecycle.** INSTALL and UNINSTALL webhooks create or deactivate installs. Refresh tokens are rotated and stored; a failed refresh marks the install `needs_reauth`.

### Data (migration)
- `calldesk_highlevel_installs`: `location_id` (unique), `company_id`, `user_id`, `access_token`, `refresh_token`, `expires_at`, `tenant_id` (null until linked), `status` (active, needs_reauth, uninstalled), timestamps. Tokens encrypted with a server key.
- `calldesk_highlevel_trigger_subscriptions`: `id`, `location_id`, `trigger_key`, `hl_trigger_id`, `target_url`, `filters` (jsonb), `active`.

### Security
- Every HighLevel-to-us request carries a shared secret header configured in the Marketplace action and trigger; compare in constant time. `extras.locationId` is trusted only after that check, and must map to a linked, active install. Never accept a tenant id from the body.
- Same guards as the public API: rate limit per workspace, pilot block, do-not-call list, E.164 validation, calling-hours rules for international numbers.
- No tokens in logs. Refresh-token rotation done in a single transaction so a crash cannot lose the new token.
- Trigger `targetUrl` accepted only if its host is `services.leadconnectorhq.com` over https (SSRF guard).

### Billing choices (decide)
- **Own billing (recommended, matches earlier direction):** free app, Calldesk subscription through Stripe. Agencies resell by creating workspaces per client.
- **HighLevel billing:** their checkout, usage pricing and rebilling to sub-accounts, monthly payout through Tipalti. Simpler for agencies to buy, but ties us to their terms and payout schedule.

## Milestones
1. Migration, install store, OAuth callback, link page, token refresh (about 2 days).
2. Place-call action plus Dynamic options (about 1 day).
3. Subscription endpoint plus completed-call dispatcher (about 2 days).
4. Developer portal setup and end-to-end test in the owner's sub-account (about 1 day, needs the owner in the portal).
5. Listing, assets, privacy and support pages, submit for review (HighLevel's timeline).

Total: about a week of focused work for a working private app. Public listing adds HighLevel's review time.

## Owner steps in the HighLevel developer portal
Create a developer account and an app (start as a private app), set the redirect URL, scopes (contacts.readonly, contacts.write, workflows.readonly), and a shared secret header for actions and triggers. Share the client id and secret through a secrets channel, never in chat or the repo.
