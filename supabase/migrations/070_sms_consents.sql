-- SMS marketing consents collected on the /try page (linked from outreach emails).
-- One row per outreach message (the signed link token identifies it). The consent text shown, its version, a timestamp, the
-- IP and the user agent are kept as proof of consent. A row with sms_opt_in = true is consent to MARKETING texts only once a
-- marketing 10DLC campaign is approved: sms_status stays 'pending_campaign' until a sender confirms it. Nothing is texted from here.
CREATE TABLE IF NOT EXISTS calldesk_sms_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  message_id uuid NOT NULL UNIQUE,
  lead_id uuid,
  product text,
  phone text NOT NULL,
  sms_opt_in boolean NOT NULL DEFAULT false,
  sms_status text NOT NULL DEFAULT 'declined'
    CHECK (sms_status IN ('declined', 'pending_campaign', 'confirmed', 'suppressed_stop_on_file', 'revoked')),
  consent_text text,
  consent_version text,
  ip text,
  user_agent text,
  coupon_code text,
  source text NOT NULL DEFAULT 'outreach-try-form'
);
CREATE INDEX IF NOT EXISTS calldesk_sms_consents_phone_idx ON calldesk_sms_consents (phone);
CREATE INDEX IF NOT EXISTS calldesk_sms_consents_optin_idx ON calldesk_sms_consents (sms_status) WHERE sms_opt_in;
-- Service-role only, same as the other outreach tables: written by the /try route, read by the admin console.
ALTER TABLE calldesk_sms_consents ENABLE ROW LEVEL SECURITY;
