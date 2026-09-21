-- Environment-scoped versioning (Retell parity: "Agent Versioning 2.0").
-- Today, a phone number's inbound/outbound slot pins directly to one
-- immutable agent version — promoting a new version means re-routing every
-- number by hand, and there's no "test before it's live" separation.
--
-- This adds named environments per agent (staging, production), each
-- pointing at one version. A phone number (or batch call, or test call) can
-- route to an ENVIRONMENT instead of a raw version — whatever version that
-- environment currently points to is what runs. Promoting a version means
-- repointing the environment (instant, no re-routing); rolling back is the
-- same operation in reverse. Direct version-pin routing keeps working
-- unchanged — this is additive, not a replacement.

CREATE TABLE IF NOT EXISTS calldesk_agent_environments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID REFERENCES calldesk_agents(id) ON DELETE CASCADE,
  name VARCHAR(20) NOT NULL CHECK (name IN ('staging', 'production')),
  version_id UUID REFERENCES calldesk_agent_versions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (agent_id, name)
);

CREATE INDEX IF NOT EXISTS idx_calldesk_agent_environments_agent ON calldesk_agent_environments(agent_id);

CREATE TRIGGER update_calldesk_agent_environments_updated_at
  BEFORE UPDATE ON calldesk_agent_environments
  FOR EACH ROW EXECUTE FUNCTION calldesk_update_updated_at_column();

-- Backfill: every existing agent gets both environments, production pointed
-- at its current latest version (so nothing changes behavior on its own —
-- an environment has to be explicitly wired into a phone number's routing
-- to take effect at all).
INSERT INTO calldesk_agent_environments (agent_id, name, version_id)
SELECT a.id, 'production',
  (SELECT v.id FROM calldesk_agent_versions v WHERE v.agent_id = a.id ORDER BY v.version_number DESC LIMIT 1)
FROM calldesk_agents a
ON CONFLICT (agent_id, name) DO NOTHING;

INSERT INTO calldesk_agent_environments (agent_id, name, version_id)
SELECT a.id, 'staging', NULL
FROM calldesk_agents a
ON CONFLICT (agent_id, name) DO NOTHING;

-- Phone numbers: additive environment pointers alongside the existing direct
-- version pins. When set, the environment wins over the raw version id at
-- resolve time (see resolveInboundCall in call-loop-poc/tenantLookup.js and
-- the API's routing route) — this is deliberately a pointer to a pointer,
-- not a replacement column, so existing direct-pin routing is untouched.
ALTER TABLE calldesk_phone_numbers
  ADD COLUMN IF NOT EXISTS inbound_environment_id UUID REFERENCES calldesk_agent_environments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outbound_environment_id UUID REFERENCES calldesk_agent_environments(id) ON DELETE SET NULL;
