-- HighLevel Marketplace app installs: one row per HighLevel sub-account (location) that installed the Calldesk app.
-- Tokens are stored encrypted (AES-256-GCM, key in HIGHLEVEL_TOKEN_KEY). tenant_id stays null until a Calldesk owner
-- links the install to a workspace. Service role only: RLS on, no policies.
CREATE TABLE IF NOT EXISTS calldesk_highlevel_installs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id text NOT NULL UNIQUE,
  company_id text,
  hl_user_id text,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  tenant_id uuid REFERENCES calldesk_tenants(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_reauth', 'uninstalled')),
  installed_at timestamptz NOT NULL DEFAULT now(),
  linked_at timestamptz,
  uninstalled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calldesk_highlevel_installs_tenant_idx ON calldesk_highlevel_installs (tenant_id) WHERE tenant_id IS NOT NULL;
ALTER TABLE calldesk_highlevel_installs ENABLE ROW LEVEL SECURITY;
