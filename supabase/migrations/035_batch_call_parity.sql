-- Batch Call feature parity with Retell: naming, per-number personalization
-- (dynamic variables from extra CSV columns), scheduling for a future time,
-- and optional calling-hours/day-of-week restrictions.

ALTER TABLE calldesk_batch_calls
  ADD COLUMN IF NOT EXISTS name TEXT,
  -- NULL = run immediately when triggered (today's only behavior). Set = the
  -- batch stays 'pending' until this time; the due-batches cron then runs it.
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  -- { timezone: "America/New_York", days: [1,2,3,4,5], start_hour: 9, end_hour: 18 }
  -- NULL = no restriction (today's only behavior). Checked both at scheduled
  -- trigger time and on a manual Run.
  ADD COLUMN IF NOT EXISTS call_time_window JSONB;

ALTER TABLE calldesk_batch_call_targets
  -- Extra CSV columns for this row, e.g. {"first_name": "Alex", "appt_time": "3pm"}.
  -- Substituted into the flow the same way globalSettings.variables already is
  -- (poc engine) or passed as retell_llm_dynamic_variables (Retell engine).
  ADD COLUMN IF NOT EXISTS dynamic_variables JSONB;

CREATE INDEX IF NOT EXISTS idx_calldesk_batch_calls_scheduled
  ON calldesk_batch_calls(scheduled_at) WHERE status = 'pending' AND scheduled_at IS NOT NULL;
