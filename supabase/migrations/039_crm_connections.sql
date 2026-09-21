-- CRM sync (HubSpot now; Salesforce documented-only, see src/lib/salesforce.ts).
-- One connection per tenant+provider. Tokens are write-only from the API's
-- perspective: every SELECT that can reach an API response excludes
-- access_token/refresh_token, mirroring how calldesk_api_keys never returns
-- its key_hash. Never log these columns in plaintext (see src/lib/hubspot.ts).
CREATE TABLE IF NOT EXISTS calldesk_crm_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('hubspot', 'salesforce')),
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  -- HubSpot's own numeric portal/hub id (hub_id from the token info
  -- response) — lets us show "Connected to portal 12345678" without a
  -- second round trip, and is not itself a secret.
  provider_account_id VARCHAR(100),
  connected_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_calldesk_crm_connections_tenant_id ON calldesk_crm_connections(tenant_id);

ALTER TABLE calldesk_crm_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own crm connections" ON calldesk_crm_connections
  FOR ALL USING (tenant_id IN (SELECT id FROM calldesk_tenants WHERE user_id = auth.uid()::text));

CREATE TRIGGER update_calldesk_crm_connections_updated_at
  BEFORE UPDATE ON calldesk_crm_connections
  FOR EACH ROW EXECUTE FUNCTION calldesk_update_updated_at_column();
