-- Per-lead research dossier (produced by the Mac mini harness's research stage)
-- and the source pages each draft was based on. Additive only.
ALTER TABLE calldesk_outreach_leads
  ADD COLUMN IF NOT EXISTS research JSONB,
  ADD COLUMN IF NOT EXISTS researched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fit VARCHAR(10) CHECK (fit IN ('high', 'medium', 'low', 'unclear'));

ALTER TABLE calldesk_outreach_messages
  ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '[]'::jsonb;
