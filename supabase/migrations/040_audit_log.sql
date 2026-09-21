-- Audit log: who did what, when, to which tenant/resource. Built as part of
-- HIPAA/SOC2 readiness groundwork (2026-09-21) — RBAC (migration 038,
-- src/lib/authz.ts) enforces who *may* act, but until now nothing recorded
-- who actually *did* act. This is an append-only log of security-relevant
-- actions: team invite/role-change/remove, API key create/revoke, agent
-- delete. Not a general-purpose activity feed — only actions that matter for
-- an access-control audit trail.
--
-- No RLS/UPDATE/DELETE policy is added deliberately: writes go through the
-- service-role client only (same pattern as every other calldesk_ table),
-- and there is intentionally no route that lets an app user edit or delete
-- rows here — an audit log that can be edited by the thing it's auditing
-- isn't one.

CREATE TABLE IF NOT EXISTS calldesk_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES calldesk_users(id) ON DELETE SET NULL,
  -- Free-text but from a known set in practice (see src/lib/auditLog.ts):
  -- team.invite, team.role_change, team.remove, apikey.create,
  -- apikey.revoke, agent.delete.
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id VARCHAR(255),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calldesk_audit_log_tenant ON calldesk_audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calldesk_audit_log_actor ON calldesk_audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_calldesk_audit_log_resource ON calldesk_audit_log(resource_type, resource_id);
