-- Daily call batches for the hired cold callers. Each caller is assigned a fresh set of numbers per
-- day; the sales line (/api/twilio/outbound-voice) only dials numbers that are in the caller's batch for
-- today, and refuses a call outside legal calling hours using the row's state. The caller records one
-- outcome per row; "do_not_call" also blocks the number for everyone (see calldesk_do_not_call).

CREATE TABLE IF NOT EXISTS calldesk_call_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The calendar date (America/New_York) the batch is for; callers work US Eastern business hours.
  batch_date DATE NOT NULL,
  sip_username TEXT NOT NULL REFERENCES calldesk_outbound_callers(sip_username),
  lead_id UUID REFERENCES calldesk_outreach_leads(id) ON DELETE SET NULL,
  -- E.164, normalized at batch time so it matches what the softphone dials regardless of how the
  -- lead's own phone column is formatted.
  phone TEXT NOT NULL,
  company_name TEXT NOT NULL,
  -- Two-letter US state of the business: drives the local-time display and the calling-hours check.
  state TEXT,
  position INT NOT NULL,
  -- 1 = first dial of this number, 2 = the single retry at a different time of day.
  attempt INT NOT NULL DEFAULT 1,
  outcome TEXT CHECK (outcome IN (
    'no_answer', 'voicemail', 'gatekeeper', 'callback_requested',
    'forward_number_requested', 'not_interested', 'wrong_number', 'do_not_call'
  )),
  notes TEXT,
  outcome_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_date, sip_username, phone)
);

CREATE INDEX IF NOT EXISTS idx_calldesk_call_batches_day ON calldesk_call_batches(batch_date, sip_username, position);
CREATE INDEX IF NOT EXISTS idx_calldesk_call_batches_phone ON calldesk_call_batches(phone);

-- Admin/service-role data only, same shape as 058/061: RLS on, no policies.
ALTER TABLE calldesk_call_batches ENABLE ROW LEVEL SECURITY;
