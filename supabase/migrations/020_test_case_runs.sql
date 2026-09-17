-- Simulation "Run" — a synthetic caller LLM converses with the agent's real
-- published flow (over text, via textFlowEngine — no real phone call), then
-- a judge LLM scores the transcript against the test case's own success
-- criteria. One row per run, so a test case's run history can be shown later
-- (Batch Testing History, not built yet — this is just the storage).
CREATE TABLE IF NOT EXISTS calldesk_test_case_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_case_id UUID NOT NULL REFERENCES calldesk_agent_test_cases(id) ON DELETE CASCADE,
  passed BOOLEAN NOT NULL,
  reasoning TEXT NOT NULL,
  transcript JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_test_case_runs_test_case_id ON calldesk_test_case_runs(test_case_id);
