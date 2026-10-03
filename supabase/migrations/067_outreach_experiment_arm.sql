-- DRAFT, NOT APPLIED. Review, then apply by hand (do not auto-apply from CI).
--
-- Experiment arm for the freight first-email A/B ('free_week' = one-week pilot offer, 'demo' = ask for a
-- 15-minute demo). It cannot live in `variant`: that column (migration 043) already means the sample-call
-- A/B ('plain' | 'sample') and /api/admin/outreach/samples/stats groups every sent message that has a
-- variant by it, so writing 'free_week'/'demo' there would corrupt that report and the sender's own
-- variant write would overwrite the arm. The two experiments are independent, so they get separate columns.
--
-- Nullable and unindexed-by-default: only freight messages drafted while OUTREACH_FREIGHT_EXPERIMENT=on get a
-- value (follow-ups copy the lead's arm). NULL = not part of the experiment. Apply this BEFORE turning the
-- env var on, or drafting fails loudly with "experiment_arm column missing".

ALTER TABLE calldesk_outreach_messages
  ADD COLUMN IF NOT EXISTS experiment_arm TEXT;

-- Partial index: the arm report only ever looks at rows that have an arm.
CREATE INDEX IF NOT EXISTS idx_calldesk_outreach_messages_experiment_arm
  ON calldesk_outreach_messages (experiment_arm)
  WHERE experiment_arm IS NOT NULL;

COMMENT ON COLUMN calldesk_outreach_messages.experiment_arm IS
  'freight first-email experiment arm: free_week | demo. NULL = not in the experiment. Distinct from variant (plain|sample).';
