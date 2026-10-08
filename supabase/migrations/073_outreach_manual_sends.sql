-- One-off emails sent by hand from the outreach address (replies to prospects and partners), logged here
-- because calldesk_outreach_messages allows one live message per lead and requires a lead.
CREATE TABLE IF NOT EXISTS calldesk_outreach_manual_sends (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  brand TEXT NOT NULL DEFAULT 'calldesk',
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  from_email TEXT,
  reply_to TEXT,
  bcc TEXT[] NOT NULL DEFAULT '{}',
  in_reply_to TEXT,
  lead_id UUID REFERENCES calldesk_outreach_leads(id) ON DELETE SET NULL,
  status VARCHAR(10) NOT NULL CHECK (status IN ('sent', 'failed')),
  resend_id TEXT,
  error TEXT,
  sent_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_calldesk_outreach_manual_sends_to ON calldesk_outreach_manual_sends(lower(to_email));
CREATE INDEX IF NOT EXISTS idx_calldesk_outreach_manual_sends_created ON calldesk_outreach_manual_sends(created_at DESC);
-- Internal tooling: service role only, like the other outreach tables.
ALTER TABLE calldesk_outreach_manual_sends ENABLE ROW LEVEL SECURITY;
