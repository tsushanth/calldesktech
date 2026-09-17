-- Simulation tab (first pass): stores test cases only, no run/batch-testing
-- execution yet — that needs its own call-orchestration work. Matches
-- Retell's own Simulation > Test Cases table shape (name, user prompt,
-- success criteria).
CREATE TABLE IF NOT EXISTS calldesk_agent_test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES calldesk_agents(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  user_prompt TEXT NOT NULL,
  success_criteria TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_test_cases_agent_id ON calldesk_agent_test_cases(agent_id);
