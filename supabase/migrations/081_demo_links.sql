-- Demo links: an unguessable, expiring link that lets one visitor talk to a specific demo agent in the browser
-- (/talk/<slug>), built for a prospect. The page loads the agent's flow and voice from here, so a prospect's setup never
-- lives in the (public) code repository. Service role only: RLS on, no policies.
CREATE TABLE IF NOT EXISTS calldesk_demo_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[A-Za-z0-9_-]{16,64}$'),
  agent_version_id uuid NOT NULL REFERENCES calldesk_agent_versions(id) ON DELETE CASCADE,
  label text NOT NULL,
  max_seconds integer NOT NULL DEFAULT 300 CHECK (max_seconds BETWEEN 30 AND 900),
  expires_at timestamptz NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE calldesk_demo_links ENABLE ROW LEVEL SECURITY;
