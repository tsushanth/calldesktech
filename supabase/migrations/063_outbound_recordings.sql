-- Call recordings for the hired callers' calls. The audio stays on Twilio (kept until deleted); each call's row
-- holds the pointer, plus room for the transcript, summary and rule-check flags written by a later step, so
-- transcription can run at any time from the stored recording SID without another migration.
ALTER TABLE calldesk_outbound_calls
  ADD COLUMN IF NOT EXISTS recording_sid TEXT,
  ADD COLUMN IF NOT EXISTS recording_url TEXT,
  ADD COLUMN IF NOT EXISTS recording_seconds INT,
  ADD COLUMN IF NOT EXISTS transcript JSONB,
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS review_flags JSONB;
CREATE INDEX IF NOT EXISTS idx_calldesk_outbound_calls_recording ON calldesk_outbound_calls(recording_sid) WHERE recording_sid IS NOT NULL;
