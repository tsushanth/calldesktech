-- Opt-in "flat" payload format for outbound webhooks (single-level JSON for HighLevel / Zapier).
-- Default 'nested' keeps every existing webhook byte-for-byte unchanged.
ALTER TABLE calldesk_webhooks
  ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'nested' CHECK (format IN ('nested', 'flat'));
