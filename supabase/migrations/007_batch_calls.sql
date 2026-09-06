-- Batch Call — mirrors Retell's own "Batch Call" screen: a user pastes/uploads
-- a list of phone numbers, picks one agent VERSION to place them with, and the
-- system dials each number in turn via the same outbound path a single call
-- uses. A batch is a lightweight header (which version, overall status); each
-- number it targets is a row that tracks its own dial state and, once placed,
-- points back at the calldesk_call_logs row that call produced.
--
-- Placement itself is retell-engine only (it's a real outbound PSTN call, like
-- /api/demo-call) — the trigger route rejects a poc-engine version rather than
-- silently no-op'ing, so a picked version that can't actually dial fails loudly.

CREATE TABLE IF NOT EXISTS calldesk_batch_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  -- The agent version every number in this batch is dialed with. ON DELETE
  -- SET NULL (not CASCADE) keeps the batch's history around even if the
  -- version is later removed — matches how phone-number routing slots behave.
  agent_version_id UUID REFERENCES calldesk_agent_versions(id) ON DELETE SET NULL,
  -- pending: created, not yet triggered. running: the trigger route is
  -- walking its targets. completed: every target reached a terminal state.
  -- failed: the batch couldn't start at all (e.g. no from-number resolvable).
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calldesk_batch_call_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID REFERENCES calldesk_batch_calls(id) ON DELETE CASCADE,
  phone_number VARCHAR(20) NOT NULL,
  -- pending: not yet dialed. calling: create-phone-call succeeded, call is
  -- live. failed: this specific number couldn't be placed (bad number, Retell
  -- error) — the batch continues past it. call_log_id is filled once the
  -- call's log row exists, linking a target to its transcript/outcome.
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'calling', 'failed')),
  call_log_id UUID REFERENCES calldesk_call_logs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calldesk_batch_calls_tenant_id ON calldesk_batch_calls(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calldesk_batch_call_targets_batch_id ON calldesk_batch_call_targets(batch_id);

ALTER TABLE calldesk_batch_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_batch_call_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own batch calls" ON calldesk_batch_calls
  FOR ALL USING (tenant_id IN (SELECT id FROM calldesk_tenants WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can manage own batch call targets" ON calldesk_batch_call_targets
  FOR ALL USING (
    batch_id IN (
      SELECT b.id FROM calldesk_batch_calls b
      JOIN calldesk_tenants t ON b.tenant_id = t.id
      WHERE t.user_id = auth.uid()::text
    )
  );

CREATE TRIGGER update_calldesk_batch_calls_updated_at
  BEFORE UPDATE ON calldesk_batch_calls
  FOR EACH ROW EXECUTE FUNCTION calldesk_update_updated_at_column();
