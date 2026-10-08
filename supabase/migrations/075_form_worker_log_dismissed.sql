-- The Worker tab's "Done" button: when a human finishes a form the worker could not, the attempt rows for that lead are dismissed (hidden from the
-- tab's "needs you" and "failed" lists and their counts) and the lead itself is marked submitted so the worker never retries it.
ALTER TABLE calldesk_form_worker_log ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;
ALTER TABLE calldesk_form_worker_log ADD COLUMN IF NOT EXISTS dismissed_by TEXT;
CREATE INDEX IF NOT EXISTS idx_calldesk_form_worker_log_open ON calldesk_form_worker_log(outcome, created_at DESC) WHERE dismissed_at IS NULL;
