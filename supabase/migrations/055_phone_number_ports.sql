-- Real Twilio-backed number-porting tracking.
--
-- Replaces the fake source: 'ported'|'purchased' label on calldesk_phone_numbers
-- with an actual submission + status-tracking flow against Twilio's Porting API
-- (public beta, REST-only, no SDK helper methods — see
-- POST https://numbers.twilio.com/v1/Porting/PortIn and
-- GET  https://numbers.twilio.com/v1/Porting/PortIn/{PortInRequestSid}).
--
-- One row per port-in request Twilio issued a port_in_request_sid for.
-- A request can cover multiple numbers on Twilio's side; we keep this simple
-- (one number per row) since the dashboard flow submits one number at a time.

CREATE TABLE IF NOT EXISTS phone_number_ports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES calldesk_tenants(id) ON DELETE CASCADE,

  -- The number being ported in, E.164.
  number VARCHAR(20) NOT NULL,

  -- Twilio's identifier for the port-in request (port_in_request_sid, "KW..."),
  -- set once the submit call succeeds. Null until then.
  twilio_port_in_request_sid TEXT,

  -- Twilio's port_in_request_status, or a local status before submission
  -- succeeds / if it fails. Local statuses: 'draft', 'submit_failed'.
  -- Twilio statuses (as documented): 'In progress', 'Completed', 'Expired',
  -- 'In review', 'Waiting for Signature', 'Action Required', 'Canceled'.
  status TEXT NOT NULL DEFAULT 'draft',

  -- Losing-carrier / billing info Twilio's PortIn create call requires.
  losing_carrier_name TEXT,
  customer_type TEXT, -- 'Individual' | 'Business'
  authorized_representative TEXT,
  authorized_representative_email TEXT,
  account_telephone_number TEXT, -- the number's current billing/account phone
  account_number TEXT, -- carrier account number (required for US local numbers)
  billing_address JSONB DEFAULT '{}'::jsonb, -- street/city/state/zip/country

  -- Document SIDs Twilio requires (>=1 Utility Bill) for the LOA — this repo
  -- does not build a document-upload flow, so this is populated only if the
  -- caller already has document SIDs from elsewhere; submission will fail at
  -- Twilio if left empty, and that failure is surfaced as submit_failed.
  document_sids JSONB DEFAULT '[]'::jsonb,

  target_port_in_date DATE,
  notification_emails JSONB DEFAULT '[]'::jsonb,

  -- Raw request/response payloads for debugging, never surfaced verbatim to
  -- customers beyond status/id.
  last_submit_error TEXT,
  last_status_response JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_number_ports_tenant_id ON phone_number_ports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_phone_number_ports_twilio_sid ON phone_number_ports(twilio_port_in_request_sid);

ALTER TABLE phone_number_ports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own phone number ports" ON phone_number_ports
  FOR ALL USING (tenant_id IN (SELECT id FROM calldesk_tenants WHERE user_id = auth.uid()::text));

CREATE TRIGGER update_phone_number_ports_updated_at
  BEFORE UPDATE ON phone_number_ports
  FOR EACH ROW EXECUTE FUNCTION calldesk_update_updated_at_column();
