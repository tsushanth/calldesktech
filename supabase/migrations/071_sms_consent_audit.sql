-- Audit trail for SMS marketing consent (extends 070). Two APPEND-ONLY tables: rows can be inserted but never updated, deleted or
-- truncated (trigger), so the record of exactly what a person saw and agreed to cannot be edited later.
--   calldesk_sms_consent_texts   one row per wording version: the text, its SHA-256, and the whole form copy shown with it.
--   calldesk_sms_consent_events  one row per form submission (opted in or not): phone, checkbox state, the exact text and form copy
--                                 shown, hashes, page URL, referrer, language, IP and user agent. Never overwritten by a re-submit.
-- calldesk_sms_consents (070) stays the current-state row per outreach message; it is derived from these events.
-- SEPARATION: numbers here come ONLY from people who typed them into the /try form. Phone numbers scraped from business websites live
-- in calldesk_outreach_leads (phone / signals.registry.phone) and must never be copied into these tables or used for marketing SMS.
-- The only supported marketing-SMS audience is the view calldesk_sms_marketing_audience below.
ALTER TABLE calldesk_sms_consents ADD COLUMN IF NOT EXISTS consent_sha256 text;

CREATE TABLE IF NOT EXISTS calldesk_sms_consent_texts (
  version text PRIMARY KEY,
  sha256 text NOT NULL,
  consent_text text NOT NULL,
  form_copy jsonb NOT NULL,
  first_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calldesk_sms_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  message_id uuid NOT NULL,
  lead_id uuid,
  product text,
  phone text NOT NULL,
  sms_opt_in boolean NOT NULL,
  checkbox_default_checked boolean NOT NULL DEFAULT false,
  consent_version text NOT NULL,
  consent_text text NOT NULL,
  consent_sha256 text NOT NULL,
  form_copy jsonb NOT NULL,
  form_sha256 text NOT NULL,
  page_url text,
  referrer text,
  accept_language text,
  ip text,
  user_agent text,
  coupon_code text,
  source text NOT NULL DEFAULT 'outreach-try-form'
);
CREATE INDEX IF NOT EXISTS calldesk_sms_consent_events_phone_idx ON calldesk_sms_consent_events (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS calldesk_sms_consent_events_msg_idx ON calldesk_sms_consent_events (message_id, created_at DESC);

CREATE OR REPLACE FUNCTION calldesk_sms_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END $$;
DROP TRIGGER IF EXISTS calldesk_sms_consent_events_immutable ON calldesk_sms_consent_events;
CREATE TRIGGER calldesk_sms_consent_events_immutable BEFORE UPDATE OR DELETE ON calldesk_sms_consent_events
  FOR EACH ROW EXECUTE FUNCTION calldesk_sms_audit_immutable();
DROP TRIGGER IF EXISTS calldesk_sms_consent_events_no_truncate ON calldesk_sms_consent_events;
CREATE TRIGGER calldesk_sms_consent_events_no_truncate BEFORE TRUNCATE ON calldesk_sms_consent_events
  FOR EACH STATEMENT EXECUTE FUNCTION calldesk_sms_audit_immutable();
DROP TRIGGER IF EXISTS calldesk_sms_consent_texts_immutable ON calldesk_sms_consent_texts;
CREATE TRIGGER calldesk_sms_consent_texts_immutable BEFORE UPDATE OR DELETE ON calldesk_sms_consent_texts
  FOR EACH ROW EXECUTE FUNCTION calldesk_sms_audit_immutable();
ALTER TABLE calldesk_sms_consent_texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_sms_consent_events ENABLE ROW LEVEL SECURITY;

-- The ONLY allowed audience for marketing texts: numbers a person submitted with the opt-in box ticked, whose latest event is still an
-- opt-in, with no STOP on file. Nothing else (scraped, purchased, imported) belongs here. Sending still needs an approved campaign.
CREATE OR REPLACE VIEW calldesk_sms_marketing_audience AS
SELECT c.phone, c.created_at AS consented_at, c.consent_version, c.consent_sha256, c.product, c.message_id
FROM calldesk_sms_consents c
WHERE c.sms_opt_in
  AND c.sms_status IN ('pending_campaign', 'confirmed')
  AND NOT EXISTS (SELECT 1 FROM sms_opt_outs o WHERE o.phone_number = c.phone)
  AND NOT EXISTS (SELECT 1 FROM calldesk_sms_consent_events e WHERE e.phone = c.phone AND e.sms_opt_in = false AND e.created_at > c.created_at);
