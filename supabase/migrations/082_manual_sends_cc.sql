-- Manual outreach sends can now copy visible recipients (cc), e.g. when replying to a thread that already copied a colleague.
ALTER TABLE calldesk_outreach_manual_sends ADD COLUMN IF NOT EXISTS cc TEXT[] NOT NULL DEFAULT '{}';
