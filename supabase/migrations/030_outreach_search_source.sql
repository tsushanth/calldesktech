-- Adds 'search' as a lead source (agencies found by the daily web-search
-- source, alongside the Retell directory). Additive: widens a CHECK only.
ALTER TABLE calldesk_outreach_leads DROP CONSTRAINT IF EXISTS calldesk_outreach_leads_signal_source_check;
ALTER TABLE calldesk_outreach_leads ADD CONSTRAINT calldesk_outreach_leads_signal_source_check
  CHECK (signal_source IN ('job_posting', 'review_site', 'tech_fingerprint', 'manual', 'directory', 'search'));
