-- Trial SMS Onboarding System
-- Tracks prospects who set up a free trial entirely over SMS.

-- Onboarding sessions: one row per prospect phone number
CREATE TABLE IF NOT EXISTS trial_sms_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_phone TEXT NOT NULL,
  to_phone TEXT NOT NULL,
  step TEXT NOT NULL DEFAULT 'greeting',

  -- Collected onboarding data
  company_name TEXT,
  greeting TEXT,
  transfer_number TEXT,
  timezone TEXT DEFAULT 'America/New_York',

  -- Created resources
  agent_id TEXT,
  agent_version_id TEXT,
  phone_number_id TEXT,
  assigned_number TEXT,

  -- Session tracking
  last_inbound_sms_id UUID,
  trial_live_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '14 days',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_trial_sms_from_to ON trial_sms_sessions(from_phone, to_phone);
CREATE INDEX idx_trial_sms_step ON trial_sms_sessions(step) WHERE step <> 'completed';

-- Trial message log (tracks which calldesk_sms_messages we've processed)
CREATE TABLE IF NOT EXISTS trial_sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES trial_sms_sessions(id) ON DELETE CASCADE,
  sms_message_id UUID REFERENCES calldesk_sms_messages(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  body TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_trial_sms_unique_message ON trial_sms_messages(session_id, sms_message_id);
