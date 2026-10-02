-- The hired callers' working page (/caller) and the supervisor view (/caller/admin).
-- Each person gets a private link; only a hash of the token is stored, so a database read cannot reveal a link.
ALTER TABLE calldesk_outbound_callers
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'caller' CHECK (role IN ('caller', 'admin')),
  ADD COLUMN IF NOT EXISTS access_token_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_calldesk_outbound_callers_token
  ON calldesk_outbound_callers(access_token_hash) WHERE access_token_hash IS NOT NULL;

-- When a prospect says yes to a text, the caller records their mobile number and that they agreed.
ALTER TABLE calldesk_call_batches
  ADD COLUMN IF NOT EXISTS mobile_number TEXT,
  ADD COLUMN IF NOT EXISTS text_ok BOOLEAN NOT NULL DEFAULT FALSE;
