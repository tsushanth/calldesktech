-- AI Quality Assurance — automated post-call review, matching Retell's
-- per-call QA. After the `call_ended` webhook saves a call's transcript, that
-- transcript is sent to Claude, which returns the caller's overall sentiment,
-- a 1–5 quality score for how well the agent handled the call (including
-- whether it followed its own instructions), and a short critique. The result
-- lands in these columns.
--
-- Stored inline on calldesk_call_logs rather than in a separate table because
-- QA is a strict 1:1 extension of a call record — the same way Retell models
-- it — so a join would buy nothing and every reader already loads the call row.

ALTER TABLE calldesk_call_logs
  -- Lifecycle of the QA pass for this call:
  --   pending   — transcript exists (or call just logged) but QA hasn't run
  --   completed — Claude scored it; qa_sentiment/qa_score/qa_critique are set
  --   failed    — QA was attempted but errored (no transcript-independent retry)
  --   skipped   — no transcript to score (e.g. abandoned before any speech)
  ADD COLUMN IF NOT EXISTS qa_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (qa_status IN ('pending', 'completed', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS qa_sentiment VARCHAR(10)
    CHECK (qa_sentiment IN ('positive', 'neutral', 'negative')),
  ADD COLUMN IF NOT EXISTS qa_score SMALLINT
    CHECK (qa_score BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS qa_critique TEXT,
  -- Which model produced the score, for auditability if CALL_QA_MODEL changes.
  ADD COLUMN IF NOT EXISTS qa_model VARCHAR(50),
  ADD COLUMN IF NOT EXISTS qa_analyzed_at TIMESTAMPTZ;

-- The QA dashboard filters by sentiment and sorts/aggregates by score within a
-- tenant; these partial-friendly composite indexes keep those cheap.
CREATE INDEX IF NOT EXISTS idx_calldesk_call_logs_qa_sentiment
  ON calldesk_call_logs(tenant_id, qa_sentiment);
CREATE INDEX IF NOT EXISTS idx_calldesk_call_logs_qa_status
  ON calldesk_call_logs(tenant_id, qa_status);
