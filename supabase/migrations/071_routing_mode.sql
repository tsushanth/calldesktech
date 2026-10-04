-- Expert backup (src/lib/expertBackup.ts). NOT yet applied: apply before deploying the code that writes these columns.
--
-- calldesk_agent_versions.routing_mode: NULL = standard routing (every existing row). 'expert_backup' = the version's normal tier model
-- answers and hands uncertain turns to a stronger model; billed as a separate per-call-second extra (docs/tiered-billing.md).
-- calldesk_call_logs.routing_mode: written by the voice engine ('expert_backup') on calls where the feature was actually active; the
-- daily usage cron bills the seconds of those calls on the expert backup meter.
-- The CHECK only stops junk and must be widened if another routing mode is added.
ALTER TABLE calldesk_agent_versions
  ADD COLUMN IF NOT EXISTS routing_mode TEXT CHECK (routing_mode IS NULL OR routing_mode = 'expert_backup');
ALTER TABLE calldesk_call_logs
  ADD COLUMN IF NOT EXISTS routing_mode TEXT;
