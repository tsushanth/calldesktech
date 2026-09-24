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
CREATE UNIQUE INDEX IF NOT EXISTS idx_calldesk_outreach_sample_events_once
  ON calldesk_outreach_sample_events (message_id, event);
CREATE INDEX IF NOT EXISTS idx_calldesk_outreach_sample_events_sample
  ON calldesk_outreach_sample_events (sample_id, event);

ALTER TABLE calldesk_outreach_messages
  ADD COLUMN IF NOT EXISTS variant TEXT,
  ADD COLUMN IF NOT EXISTS sample_id UUID;
-- variant values: 'plain' | 'sample'

ALTER TABLE calldesk_outreach_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_outreach_sample_events ENABLE ROW LEVEL SECURITY;

-- Atomic publish: unpublish the product's current sample and publish the target in ONE transaction, so a
-- failure can never leave a product with zero published samples. Service role only.
CREATE OR REPLACE FUNCTION calldesk_publish_outreach_sample(p_sample_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product TEXT;
  v_audio TEXT;
  v_transcript JSONB;
  v_snippet JSONB;
BEGIN
  SELECT product, audio_path, transcript, snippet
    INTO v_product, v_audio, v_transcript, v_snippet
    FROM calldesk_outreach_samples
   WHERE id = p_sample_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'outreach sample % does not exist', p_sample_id;
  END IF;
  IF v_audio IS NULL OR btrim(v_audio) = '' THEN
    RAISE EXCEPTION 'outreach sample % has no audio_path', p_sample_id;
  END IF;
  IF jsonb_typeof(v_transcript) IS DISTINCT FROM 'array' OR jsonb_array_length(v_transcript) < 4 THEN
    RAISE EXCEPTION 'outreach sample % needs a transcript of at least 4 lines', p_sample_id;
  END IF;
  IF jsonb_typeof(v_snippet) IS DISTINCT FROM 'array' OR jsonb_array_length(v_snippet) < 1 THEN
    RAISE EXCEPTION 'outreach sample % needs a non-empty snippet', p_sample_id;
  END IF;

  UPDATE calldesk_outreach_samples
     SET published = FALSE
   WHERE product = v_product AND published AND id <> p_sample_id;
  UPDATE calldesk_outreach_samples
     SET published = TRUE
   WHERE id = p_sample_id;
END;
$$;

REVOKE ALL ON FUNCTION calldesk_publish_outreach_sample(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION calldesk_publish_outreach_sample(UUID) TO service_role;
