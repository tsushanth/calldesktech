-- Tenant-scoped API keys for the public API (Authorization: Bearer cdk_live_...).
-- Only a SHA-256 hash is stored; the plaintext key is shown once at creation.
CREATE TABLE IF NOT EXISTS calldesk_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  user_id TEXT,
  name VARCHAR(100) NOT NULL,
  key_prefix VARCHAR(24) NOT NULL,
  key_hash VARCHAR(64) NOT NULL UNIQUE,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calldesk_api_keys_tenant ON calldesk_api_keys(tenant_id);
