-- Applied to production on 2026-10-02 (via the Supabase console), together with 064_agent_version_tier.sql; kept here for the record. See docs/tiered-billing.md.
--
-- The pricing tier of the agent version that served a call (the engine writes it when the call is logged). NULL means the call ran on a
-- version published without a tier: it is billed at the account's flat per-minute voice price, exactly as before, so every existing row keeps
-- its meaning. Used by the billing page to split minutes by tier and by the usage-reporting job to leave tiered calls off the legacy meter.
-- The allowed ids live in code too; the CHECK only stops junk and must be widened if a tier is added.
ALTER TABLE calldesk_call_logs
  ADD COLUMN IF NOT EXISTS tier TEXT CHECK (tier IS NULL OR tier IN ('lite', 'standard', 'pro'));
