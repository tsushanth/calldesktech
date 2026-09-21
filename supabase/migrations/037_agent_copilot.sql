-- Agent Copilot: analyzes an agent's recent call history (transcripts + QA
-- critiques) and proposes concrete node-level prompt edits, grounded in real
-- transcript excerpts. Analysis-and-suggestion only — nothing here ever
-- auto-applies a suggestion to a flow; accepting one goes through the
-- existing draft-version create path (POST /api/agents/[id]/versions), same
-- as any other manual edit. This table just persists what Claude proposed
-- and its lifecycle (pending/accepted/dismissed) so the panel survives a
-- refresh and suggestions aren't re-generated identically on every view.

CREATE TABLE IF NOT EXISTS calldesk_agent_copilot_suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES calldesk_agents(id) ON DELETE CASCADE,
  version_id UUID REFERENCES calldesk_agent_versions(id) ON DELETE SET NULL,
  node_id VARCHAR(255) NOT NULL,
  current_text TEXT,
  suggested_text TEXT NOT NULL,
  rationale TEXT NOT NULL,
  supporting_call_ids JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calldesk_agent_copilot_suggestions_agent ON calldesk_agent_copilot_suggestions(agent_id);
CREATE INDEX IF NOT EXISTS idx_calldesk_agent_copilot_suggestions_status ON calldesk_agent_copilot_suggestions(agent_id, status);
