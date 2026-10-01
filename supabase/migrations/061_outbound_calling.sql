-- Human outbound calling for the sales pilot: callers dial from a SIP softphone, Twilio asks
-- /api/twilio/outbound-voice what to do with each call, and every attempt is recorded here whether or
-- not anyone picks up. The provider's records stay the ground truth for "did the dial happen";
-- outcome/notes are what the caller adds afterwards (a required field in the daily sheet today, a
-- form later).

-- Which Twilio number each softphone user dials out as. A caller with no enabled row cannot place calls.
CREATE TABLE IF NOT EXISTS calldesk_outbound_callers (
  sip_username TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  caller_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Numbers that must never be dialed (asked to be removed, hostile, wrong number). Checked on every call.
CREATE TABLE IF NOT EXISTS calldesk_do_not_call (
  phone TEXT PRIMARY KEY,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calldesk_outbound_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_sid TEXT UNIQUE,
  sip_username TEXT NOT NULL,
  lead_id UUID REFERENCES calldesk_outreach_leads(id) ON DELETE SET NULL,
  to_number TEXT NOT NULL,
  caller_id TEXT NOT NULL,
  -- initiated -> completed | busy | no-answer | failed | canceled; 'rejected' = we refused to place it.
  status TEXT NOT NULL DEFAULT 'initiated',
  reject_reason TEXT,
  answered BOOLEAN,
  duration_seconds INT,
  outcome TEXT,
  notes TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_calldesk_outbound_calls_caller_day ON calldesk_outbound_calls(sip_username, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calldesk_outbound_calls_lead ON calldesk_outbound_calls(lead_id);

-- Admin/service-role data only, same shape as 043/058: RLS on, no policies.
ALTER TABLE calldesk_outbound_callers ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_do_not_call ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_outbound_calls ENABLE ROW LEVEL SECURITY;
