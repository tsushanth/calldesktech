-- Add knowledge base columns to demo_agents table

ALTER TABLE demo_agents
  ADD COLUMN IF NOT EXISTS retell_kb_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS knowledge_base JSONB;

-- Comment on columns
COMMENT ON COLUMN demo_agents.retell_kb_id IS 'Retell knowledge base ID for this demo agent';
COMMENT ON COLUMN demo_agents.knowledge_base IS 'Array of knowledge base content strings for display on website';
