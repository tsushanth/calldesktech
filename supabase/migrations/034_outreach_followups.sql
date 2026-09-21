-- Multi-touch outreach: a lead can now receive more than one message (an
-- initial email plus follow-ups), not just one-and-done. Additive/replacing
-- only the constraint that enforced "at most one message ever per lead."

ALTER TABLE calldesk_outreach_messages ADD COLUMN IF NOT EXISTS step INT NOT NULL DEFAULT 1;

-- Manually set when the human reviewing the queue sees a reply in their inbox
-- (there is no automated reply detection) -- stops any further follow-up from
-- being drafted for that lead. NULL = no reply seen yet.
ALTER TABLE calldesk_outreach_leads ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;

-- Was: "a lead can never have more than one live (non-rejected) message."
-- Now: "a lead can never have more than one live message AT THE SAME STEP" --
-- i.e. a given follow-up step is drafted/sent once, but step 2/3/etc. are allowed.
DROP INDEX IF EXISTS idx_calldesk_outreach_messages_lead_once;
CREATE UNIQUE INDEX IF NOT EXISTS idx_calldesk_outreach_messages_lead_step_once
  ON calldesk_outreach_messages(lead_id, step) WHERE status <> 'rejected';
