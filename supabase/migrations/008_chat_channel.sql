-- Adds a text-chat channel alongside the existing voice channel. A website
-- visitor talks to the SAME node-based flow engine voice calls run (see
-- src/lib/textFlowEngine.ts, a text-only port of call-loop-poc/server.js's
-- Claude tool-calling state machine — no Deepgram/TTS), and every session is
-- persisted here the same way calldesk_call_logs persists a voice call.
--
-- calldesk_chat_sessions mirrors a "call": it belongs to a tenant, pins to the
-- agent version whose flow it ran, and has a lifespan (created_at -> ended_at,
-- ended_at NULL while the chat is still open). calldesk_chat_messages is its
-- transcript, one row per turn, exactly like a call's transcript entries.
--
-- flow_snapshot/state are an intentional addition beyond the four "spec"
-- columns (id, tenant_id, agent_version_id, created_at, ended_at): the flow
-- engine is a stateful machine, but chat turns arrive over stateless HTTP
-- requests, so the machine's position (current node + collected fields) and
-- the flow it's walking have to live somewhere durable between turns. Storing
-- them on the session row is the least surprising place. flow_snapshot also
-- pins the flow for the session's lifetime so a mid-chat edit to the agent's
-- flow can't corrupt an in-progress conversation.

CREATE TABLE IF NOT EXISTS calldesk_chat_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  -- Which agent version's flow this chat ran. Nullable: a tenant with no
  -- agent version yet still gets a working (prompt-only) chat, it just has no
  -- version to pin to.
  agent_version_id UUID REFERENCES calldesk_agent_versions(id) ON DELETE SET NULL,
  -- The flow this session is walking, captured at session start (nodes +
  -- startNodeId + globalSettings). NULL when the tenant has no flow — chat
  -- then falls back to a single prompt-only assistant.
  flow_snapshot JSONB,
  -- Engine position between turns: { currentNodeId, collectedData }.
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS calldesk_chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES calldesk_chat_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calldesk_chat_sessions_tenant_id ON calldesk_chat_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calldesk_chat_messages_session_id ON calldesk_chat_messages(session_id);

ALTER TABLE calldesk_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_chat_messages ENABLE ROW LEVEL SECURITY;

-- Dashboard reads and widget writes both go through server-side API routes
-- using the service-role key (which bypasses RLS), exactly like the voice
-- call-log surface. These owner policies exist for parity/defence-in-depth
-- with the rest of the schema; the anon key can't reach these tables.
CREATE POLICY "Users can view own chat sessions" ON calldesk_chat_sessions
  FOR ALL USING (tenant_id IN (SELECT id FROM calldesk_tenants WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can view own chat messages" ON calldesk_chat_messages
  FOR ALL USING (
    session_id IN (
      SELECT s.id FROM calldesk_chat_sessions s
      JOIN calldesk_tenants t ON s.tenant_id = t.id
      WHERE t.user_id = auth.uid()::text
    )
  );
