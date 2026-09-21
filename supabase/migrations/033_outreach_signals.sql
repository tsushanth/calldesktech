-- Evidence behind a lead's score (which signals fired, what tech fingerprinting
-- found), so the admin UI can show WHY a lead scored the way it did instead of
-- a bare number. Written by discovery/score.ts's callers; read by /admin/outreach.
ALTER TABLE calldesk_outreach_leads ADD COLUMN IF NOT EXISTS signals JSONB;
