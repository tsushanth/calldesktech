-- Tracks the last time a tenant's metered usage (voice minutes + booking/
-- transfer/message events) was successfully reported to Stripe via the
-- usage-reporting cron job (POST /api/admin/billing/report-usage).
--
-- Nullable: null means "never reported" (report everything since the
-- tenant's calldesk_call_logs began, or since subscription start).
-- Lives on calldesk_tenants rather than calldesk_businesses because a
-- reporting run is scoped per-workspace the same way usage itself is
-- computed (calldesk_call_logs.tenant_id), even though the Stripe
-- customer/subscription ids live on calldesk_businesses.

ALTER TABLE calldesk_tenants
  ADD COLUMN IF NOT EXISTS last_usage_reported_at TIMESTAMPTZ;
