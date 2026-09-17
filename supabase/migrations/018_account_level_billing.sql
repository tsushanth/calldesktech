-- Account-level (shared) billing — one Stripe subscription per USER,
-- shared across every workspace (calldesk_tenants) they own, matching
-- Retell's own model: adding a new workspace never re-asks for payment
-- info if the account already has billing.
--
-- calldesk_businesses stays exactly as it is (tenant-keyed, UNIQUE(tenant_id)
-- from migration 012) and every existing read site (paymentMethodGate.ts,
-- the billing routes, call-loop-poc's stripeMeter.js/tenantLookup.js) keeps
-- reading it unchanged — it becomes a per-tenant MIRROR of these new
-- user-level columns rather than the source of truth. This is deliberately
-- the low-blast-radius option: the alternative (moving billing off
-- calldesk_businesses entirely) would have touched every one of those call
-- sites instead of just the webhook and tenant-creation code paths.
ALTER TABLE calldesk_users
  ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'inactive';
