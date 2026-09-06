-- Make calldesk_businesses.tenant_id the real linkage key for a tenant's
-- Stripe billing.
--
-- Two pre-existing bugs made billing data never populate: the Stripe webhook
-- only ever ran .update() (never an insert, so the row was never created),
-- and it matched by `id` while the rest of the code (syncVoicePriceForTenant
-- in src/lib/stripe.ts, and the new /api/tenants/[id]/billing routes) reads
-- by `tenant_id`. The webhook now upserts by tenant_id, which needs a unique
-- constraint on that column.
--
-- A tenant has exactly one billing record, so UNIQUE(tenant_id) is the
-- correct shape. The table has no inserts today, so no dedupe is needed
-- before adding the constraint.

ALTER TABLE calldesk_businesses
  ADD CONSTRAINT calldesk_businesses_tenant_id_key UNIQUE (tenant_id);
