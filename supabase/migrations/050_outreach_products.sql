-- Generalizes outreach to more than one product: the Kreative Koala app
-- press/community pipeline reuses these tables and this admin UI/sender
-- rather than standing up a second copy of all the guardrails. Additive only.
--
-- 'calldesk' is the default so every existing row (and every existing query
-- that doesn't pass product=) keeps behaving exactly as before.

ALTER TABLE calldesk_outreach_leads ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'calldesk';
ALTER TABLE calldesk_outreach_runs ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'calldesk';
-- Copied onto the message at insert time (from its lead) so sender.ts can filter/cap
-- per product, and the footer/brand can vary, without a join on every send-guard check.
ALTER TABLE calldesk_outreach_messages ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'calldesk';
CREATE INDEX IF NOT EXISTS idx_calldesk_outreach_messages_product ON calldesk_outreach_messages(product);

-- The old domain-uniqueness index was global; two different products legitimately
-- pitch the same publication/domain about different things, so scope it by product.
DROP INDEX IF EXISTS idx_calldesk_outreach_leads_domain;
CREATE UNIQUE INDEX IF NOT EXISTS idx_calldesk_outreach_leads_product_domain
  ON calldesk_outreach_leads(product, lower(domain)) WHERE domain IS NOT NULL;
-- source_key already carries a product-specific prefix (e.g. "kk:voxkey:...", "retell:...")
-- by convention, so its existing global-unique index is left as is.

CREATE INDEX IF NOT EXISTS idx_calldesk_outreach_leads_product ON calldesk_outreach_leads(product);
