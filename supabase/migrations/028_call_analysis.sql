-- Post-call analysis: structured fields extracted from the transcript per the
-- agent version's globalSettings.postCallAnalysis schema.
ALTER TABLE calldesk_call_logs ADD COLUMN IF NOT EXISTS analysis JSONB;
