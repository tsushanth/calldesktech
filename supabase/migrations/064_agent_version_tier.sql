-- DRAFT, NOT APPLIED. Do not run until the metering work in docs/pricing-tier-migration-notes.md is agreed.
-- (Numbered 064: 063 is already taken twice, by 063_outbound_recordings.sql and 063_outreach_leads_created_at_index.sql.)
--
-- Pricing tier chosen when a version was published (src/lib/pricingTiers.ts). NULL means the version was published without a tier: it
-- stays on the flat per-minute price of its voice backend, exactly as before, so every existing row keeps its behaviour and price.
-- tier_overrides lists the model fields (llmModel, ttsBackend, ttsModel) the publisher set explicitly instead of taking the tier's choice.
-- The allowed tier ids live in code too; the CHECKs only stop junk and must be widened if a tier is added.
ALTER TABLE calldesk_agent_versions
  ADD COLUMN IF NOT EXISTS tier TEXT CHECK (tier IS NULL OR tier IN ('lite', 'standard', 'pro')),
  ADD COLUMN IF NOT EXISTS tier_overrides TEXT[] CHECK (tier_overrides IS NULL OR tier_overrides <@ ARRAY['llmModel', 'ttsBackend', 'ttsModel']);
