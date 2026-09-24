-- Delivery events pushed by Resend's webhook (delivered / bounced / complained / delivery_delayed).
-- Opens and clicks are intentionally not recorded: image prefetching makes opens unreliable, and the only
-- tracked link is our own sample page (calldesk_outreach_sample_events).
CREATE TABLE IF NOT EXISTS calldesk_outreach_email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  svix_id TEXT NOT NULL UNIQUE,
  resend_id TEXT NOT NULL,
  message_id UUID REFERENCES calldesk_outreach_messages(id) ON DELETE SET NULL,
  event TEXT NOT NULL,
  detail JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calldesk_outreach_email_events_message ON calldesk_outreach_email_events(message_id);
ALTER TABLE calldesk_outreach_email_events ENABLE ROW LEVEL SECURITY;
