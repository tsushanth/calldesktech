CREATE TABLE IF NOT EXISTS calldesk_oauth_clients (
  client_id text PRIMARY KEY,
  client_name text NOT NULL,
  redirect_uris text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS calldesk_oauth_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES calldesk_oauth_clients(client_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  tenant_id uuid NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE calldesk_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_oauth_codes ENABLE ROW LEVEL SECURITY;
