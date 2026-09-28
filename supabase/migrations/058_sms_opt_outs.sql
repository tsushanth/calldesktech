-- Cross-cutting SMS opt-out suppression list. A2P 10DLC / carrier compliance
-- requires that a STOP (or CANCEL/END/QUIT/UNSUBSCRIBE) reply on ANY number
-- suppress future sends to that phone number across all sending paths --
-- trial onboarding SMS, general inbound webhook, and outreach campaigns.
-- Previously STOP only mutated trial_sms_sessions.step, which didn't stop
-- other senders (outreach scripts, in-call SMS) from texting the same number.

CREATE TABLE IF NOT EXISTS sms_opt_outs (
  phone_number text PRIMARY KEY,
  opted_out_at timestamptz NOT NULL DEFAULT now(),
  source text
);

-- Admin/service-role data only: same shape as 043/053 (no end-user-facing
-- query path; written/read only by backend webhooks and outreach scripts
-- via the service role key).
ALTER TABLE sms_opt_outs ENABLE ROW LEVEL SECURITY;
