-- Reusable sub-graphs of flow nodes, embeddable into a 'subflow_ref' node.
-- agent_id NULL means library-scoped (reusable across every agent in the
-- tenant); non-null means agent-scoped (visible only to that one agent) —
-- matches the two tiers Retell's own builder UI exposes.
CREATE TABLE IF NOT EXISTS calldesk_subflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES calldesk_agents(id) ON DELETE CASCADE,
  scope VARCHAR(10) NOT NULL DEFAULT 'agent' CHECK (scope IN ('agent', 'library')),
  name VARCHAR(255) NOT NULL,
  nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  start_node_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (scope = 'library' OR agent_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_calldesk_subflows_tenant ON calldesk_subflows(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calldesk_subflows_agent ON calldesk_subflows(agent_id);
