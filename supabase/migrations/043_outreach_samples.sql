-- Sample-call recordings for outreach emails. One published sample per
-- vertical (product id like 'calldesk:freight'). Samples are AI-to-AI demo
-- calls against our own demo agent about a FICTIONAL business.
-- Audio lives in a PRIVATE Supabase Storage bucket `outreach-samples`.
-- Admin/service-role data only: RLS enabled, no policies (service role
-- bypasses RLS; anon/authenticated get nothing).

CREATE TABLE IF NOT EXISTS calldesk_outreach_samples (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product TEXT NOT NULL,
  title TEXT,
  business_name TEXT,
  disclosure TEXT NOT NULL,
  audio_path TEXT,
  audio_duration_sec INTEGER,
  transcript JSONB NOT NULL,
  snippet JSONB,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- At most one published sample per product.
CREATE UNIQUE INDEX IF NOT EXISTS idx_calldesk_outreach_samples_one_published
  ON calldesk_outreach_samples (product) WHERE published;

CREATE TABLE IF NOT EXISTS calldesk_outreach_sample_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID,
  sample_id UUID,
  product TEXT,
  event TEXT NOT NULL CHECK (event IN ('view', 'play', 'complete')),
  is_bot BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calldesk_outreach_sample_events_message
  ON calldesk_outreach_sample_events (message_id, event);
CREATE INDEX IF NOT EXISTS idx_calldesk_outreach_sample_events_sample
  ON calldesk_outreach_sample_events (sample_id, event);

ALTER TABLE calldesk_outreach_messages
  ADD COLUMN IF NOT EXISTS variant TEXT,
  ADD COLUMN IF NOT EXISTS sample_id UUID;
-- variant values: 'plain' | 'sample'

ALTER TABLE calldesk_outreach_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_outreach_sample_events ENABLE ROW LEVEL SECURITY;
