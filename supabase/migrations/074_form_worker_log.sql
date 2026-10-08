-- One row per attempt of the contact-form worker (harness/outreach/form-submit.ts), so the outreach queue's Worker tab can list what it
-- delivered without scanning the leads table (about half a million rows; a JSON-path scan over it takes seconds).
-- 'proof' says how a delivery was established: 'page' = the site showed a confirmation, 'email' = the company's own auto-reply arrived
-- (inbound-reply webhook). Internal tooling: service role only, like the other outreach tables.
CREATE TABLE IF NOT EXISTS calldesk_form_worker_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lead_id UUID REFERENCES calldesk_outreach_leads(id) ON DELETE SET NULL,
  product TEXT,
  company_name TEXT,
  domain TEXT,
  page_url TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('submitted', 'needs_manual', 'failed')),
  reason TEXT,
  proof TEXT NOT NULL DEFAULT 'page' CHECK (proof IN ('page', 'email')),
  confirmed_by TEXT,
  screenshot TEXT
);
CREATE INDEX IF NOT EXISTS idx_calldesk_form_worker_log_created ON calldesk_form_worker_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calldesk_form_worker_log_outcome ON calldesk_form_worker_log(outcome, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calldesk_form_worker_log_lead ON calldesk_form_worker_log(lead_id);
ALTER TABLE calldesk_form_worker_log ENABLE ROW LEVEL SECURITY;
