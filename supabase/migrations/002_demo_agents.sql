-- Demo Agents Table
-- Static agents for demo profiles that get reused

CREATE TABLE demo_agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id VARCHAR(50) NOT NULL UNIQUE, -- matches DEMO_PROFILES key (plumber, salon, etc.)
  business_name VARCHAR(255) NOT NULL,
  business_type VARCHAR(50) NOT NULL,
  retell_agent_id VARCHAR(100) NOT NULL,
  retell_llm_id VARCHAR(100) NOT NULL,
  voice_id VARCHAR(100) NOT NULL,
  greeting TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookup
CREATE INDEX idx_demo_agents_profile_id ON demo_agents(profile_id);

-- No RLS needed - these are public demo agents
ALTER TABLE demo_agents ENABLE ROW LEVEL SECURITY;

-- Allow public read access to demo agents
CREATE POLICY "Anyone can view demo agents" ON demo_agents
  FOR SELECT USING (true);

-- Apply updated_at trigger
CREATE TRIGGER update_demo_agents_updated_at
  BEFORE UPDATE ON demo_agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
