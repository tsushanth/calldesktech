-- Tracks LOA/utility-bill documents uploaded for number porting, closing the
-- gap noted in 055_phone_number_ports.sql (document_sids column): that repo
-- previously had no document-upload flow, so document_sids was always
-- populated externally or left empty (causing a real Twilio submit_failed).
--
-- One row per uploaded file, independent of any specific phone_number_ports
-- row — a tenant uploads a document BEFORE the port request exists (Twilio's
-- Document resource is account-scoped, not port-request-scoped), gets back a
-- Twilio document sid, and only then includes that sid in a port submission's
-- documentSids array. This table is what lets the port submission route
-- verify a client-supplied documentSid actually belongs to this tenant
-- (rather than trusting an opaque string from the client), mirroring the
-- belongsToTenant() pattern used elsewhere in this codebase (src/lib/authz.ts).
--
-- Raw files live in Supabase Storage, bucket 'porting-documents' (private —
-- created via the Storage admin API, matching how 'outreach-samples' is
-- created in scripts/generate-vertical-sample.mjs; there is no bucket-DDL in
-- SQL migrations elsewhere in this repo, so none is added here either).

CREATE TABLE IF NOT EXISTS phone_number_port_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES calldesk_tenants(id) ON DELETE CASCADE,

  -- Set once a phone_number_ports row actually includes this document's sid
  -- in a successful submission. Nullable: a document can be uploaded before
  -- any port row exists, and one document could in principle be reused.
  port_id UUID REFERENCES phone_number_ports(id) ON DELETE SET NULL,

  -- Supabase Storage location of the raw uploaded file (private bucket).
  storage_bucket TEXT NOT NULL DEFAULT 'porting-documents',
  storage_path TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,

  -- Twilio's Regulatory/Porting Documents API classification. 'utility_bill'
  -- is the type Twilio's porting flow requires for the LOA; kept as free
  -- text (not an enum) since Twilio supports other types this repo may need
  -- later (e.g. other proof-of-ownership documents).
  document_type TEXT NOT NULL DEFAULT 'utility_bill',
  friendly_name TEXT,

  -- Twilio's document sid ("RD..."), set once the upload to Twilio succeeds.
  -- Null until then, and stays null forever if the Twilio call fails.
  twilio_document_sid TEXT,

  -- 'pending_storage' (row inserted, storage upload not yet confirmed) ->
  -- 'stored' (in Supabase Storage, not yet sent to Twilio) -> 'uploaded'
  -- (Twilio accepted it, twilio_document_sid set) | 'twilio_upload_failed'
  -- (Twilio rejected it or the call errored — last_error has Twilio's real
  -- message, never swallowed, matching phone_number_ports' submit_failed
  -- convention).
  status TEXT NOT NULL DEFAULT 'pending_storage',
  last_error TEXT,
  last_twilio_response JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_number_port_documents_tenant_id ON phone_number_port_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_phone_number_port_documents_port_id ON phone_number_port_documents(port_id);
CREATE INDEX IF NOT EXISTS idx_phone_number_port_documents_twilio_sid ON phone_number_port_documents(twilio_document_sid);

ALTER TABLE phone_number_port_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own phone number port documents" ON phone_number_port_documents
  FOR ALL USING (tenant_id IN (SELECT id FROM calldesk_tenants WHERE user_id = auth.uid()::text));

CREATE TRIGGER update_phone_number_port_documents_updated_at
  BEFORE UPDATE ON phone_number_port_documents
  FOR EACH ROW EXECUTE FUNCTION calldesk_update_updated_at_column();
