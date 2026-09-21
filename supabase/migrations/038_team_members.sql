-- Shared foundation for two Retell-parity gaps built today: RBAC/team roles
-- and SSO. Both need the same underlying "who belongs to this workspace and
-- what can they do" model, so it's defined once, here, rather than each
-- feature inventing its own (which would collide) — RBAC owns enforcement
-- and the team UI; SSO is just another way a row in this table gets its
-- user_id filled in (via an identity provider instead of Google OAuth).
--
-- calldesk_tenants.user_id (the pre-existing single-owner column) is left
-- untouched for backward compatibility — every tenant's existing owner is
-- backfilled into this table with role='owner', and authz continues to
-- treat that column as authoritative for ownership until the RBAC work
-- migrates callers over to checking this table instead.

CREATE TABLE IF NOT EXISTS calldesk_team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  -- Set once the invited person actually signs in (matches calldesk_users.id
  -- / NextAuth's user.id). NULL while status = 'invited' and nobody with
  -- invited_email has signed in yet.
  user_id TEXT REFERENCES calldesk_users(id) ON DELETE CASCADE,
  invited_email VARCHAR(255),
  role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited')),
  invited_by TEXT REFERENCES calldesk_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (user_id IS NOT NULL OR invited_email IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_tenant_user ON calldesk_team_members(tenant_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_tenant_invited_email ON calldesk_team_members(tenant_id, invited_email) WHERE invited_email IS NOT NULL AND status = 'invited';
CREATE INDEX IF NOT EXISTS idx_team_members_tenant ON calldesk_team_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON calldesk_team_members(user_id);

CREATE TRIGGER update_calldesk_team_members_updated_at
  BEFORE UPDATE ON calldesk_team_members
  FOR EACH ROW EXECUTE FUNCTION calldesk_update_updated_at_column();

-- Backfill: every tenant's existing single owner becomes an 'owner' row.
INSERT INTO calldesk_team_members (tenant_id, user_id, role, status)
SELECT t.id, t.user_id, 'owner', 'active'
FROM calldesk_tenants t
WHERE t.user_id IS NOT NULL AND t.user_id NOT LIKE 'demo_%'
ON CONFLICT DO NOTHING;
