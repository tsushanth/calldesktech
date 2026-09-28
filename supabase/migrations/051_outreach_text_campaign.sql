-- Table for tracking Group B text-first campaign
-- Links to calldesk_outreach_leads via company_name + phone

CREATE TABLE IF NOT EXISTS outreach_text_campaign (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_rank INTEGER,
  company_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  location TEXT,
  score INTEGER,
  message_sid TEXT, -- Twilio message SID
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'replied', 'opted_out', 'failed')),
  reply_body TEXT, -- What they replied
  reply_classified TEXT CHECK (reply_classified IN ('interested', 'not_interested', 'question', 'opt_out', 'unclear')),
  ai_call_sid TEXT, -- Twilio call SID if we AI-called them back
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookups for polling
CREATE INDEX IF NOT EXISTS idx_outreach_text_status ON outreach_text_campaign(status);
CREATE INDEX IF NOT EXISTS idx_outreach_text_phone ON outreach_text_campaign(phone);
CREATE INDEX IF NOT EXISTS idx_outreach_text_replied ON outreach_text_campaign(replied_at) WHERE replied_at IS NOT NULL;
