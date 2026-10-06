-- Public "hear it" demo call: a visitor types their own US phone number into /hear, ticks the consent box, and our voice
-- engine places ONE demo call to that number. This table is the audit trail (what they agreed to, from where) and the source of
-- the per-number / per-IP / per-day limits. APPEND-ONLY for the consent fields: rows are inserted once, then only the call result
-- (status, call_sid, error) is filled in.
-- SEPARATION: numbers here come ONLY from people who typed them into the /hear form. They must never be used for marketing.
CREATE TABLE IF NOT EXISTS calldesk_hear_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  phone text NOT NULL,
  business_name text,
  consent_version text NOT NULL,
  consent_text text NOT NULL,
  consent_sha256 text NOT NULL,
  page_url text,
  referrer text,
  accept_language text,
  ip text,
  user_agent text,
  status text NOT NULL DEFAULT 'pending',  -- pending | placed | failed
  call_sid text,
  error text
);
CREATE INDEX IF NOT EXISTS calldesk_hear_requests_phone_idx ON calldesk_hear_requests (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS calldesk_hear_requests_ip_idx ON calldesk_hear_requests (ip, created_at DESC);
ALTER TABLE calldesk_hear_requests ENABLE ROW LEVEL SECURITY; -- no policies: service role only
