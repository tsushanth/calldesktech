-- Add phone number column to outreach leads so we can call businesses
-- that have no email or alongside email campaigns.

ALTER TABLE calldesk_outreach_leads
  ADD COLUMN IF NOT EXISTS phone TEXT;

-- Index for fast lookups of callable leads.
CREATE INDEX IF NOT EXISTS idx_calldesk_outreach_leads_phone
  ON calldesk_outreach_leads(phone) WHERE phone IS NOT NULL;
