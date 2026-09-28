-- Competitor parity batch 3: business hours, transcript search, recording access

-- =============================================
-- 1) Business hours per tenant
-- =============================================
CREATE TABLE IF NOT EXISTS calldesk_business_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  -- timezone IANA name, e.g. "America/New_York"
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  -- JSONB: { "monday": { "open": "09:00", "closed": "17:00" }, "tuesday": ... }
  -- If a day key is missing, the office is closed that day.
  hours JSONB NOT NULL DEFAULT '{}',
  -- Optional: phone number to transfer to after hours
  after_hours_number VARCHAR(20),
  -- Optional: agent version to route to after hours (e.g. a voicemail-only agent)
  after_hours_agent_version_id UUID REFERENCES calldesk_agent_versions(id) ON DELETE SET NULL,
  -- Message played when calls arrive outside hours (if no transfer target)
  after_hours_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_calldesk_business_hours_tenant_id ON calldesk_business_hours(tenant_id);

ALTER TABLE calldesk_business_hours ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own business hours" ON calldesk_business_hours
  FOR ALL USING (tenant_id IN (SELECT id FROM calldesk_tenants WHERE user_id = auth.uid()::text));

CREATE TRIGGER update_calldesk_business_hours_updated_at
  BEFORE UPDATE ON calldesk_business_hours
  FOR EACH ROW EXECUTE FUNCTION calldesk_update_updated_at_column();

-- =============================================
-- 2) Full-text search on call transcripts
-- =============================================
-- Add a generated tsvector column for fast transcript search
ALTER TABLE calldesk_call_logs
  ADD COLUMN IF NOT EXISTS transcript_search TSVECTOR;

-- Index it
CREATE INDEX IF NOT EXISTS idx_calldesk_call_logs_transcript_search
  ON calldesk_call_logs USING GIN(transcript_search);

-- Populate existing rows
UPDATE calldesk_call_logs
SET transcript_search = to_tsvector('english', COALESCE(transcript::text, ''))
WHERE transcript_search IS NULL AND transcript IS NOT NULL;

-- =============================================
-- 3) Recording access tracking
-- =============================================
ALTER TABLE calldesk_call_logs
  ADD COLUMN IF NOT EXISTS recording_downloaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recording_size_bytes INT;
