-- Promotes "agent" from inline fields on calldesk_tenants to a first-class,
-- versioned entity, and moves call routing onto phone numbers — matching
-- Retell's actual model (Inbound/Outbound Call Agent dropdowns per number,
-- each pointing at a specific agent VERSION). See the "Two-Tier Onboarding"
-- artifact for the full reasoning; this is schema step 1 of that plan.
--
-- A tenant now HAS agents (not IS one). An agent accumulates immutable
-- versions as it's edited — by the wizard (simple mode) or the console
-- (advanced mode) — and a phone number's inbound/outbound slots each point
-- at one specific version, not just "the agent." voice_engine moves here
-- too: it's what determines how a given version's calls actually execute.

CREATE TABLE IF NOT EXISTS calldesk_agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  -- 'simple': the wizard is authoritative and keeps writing new versions.
  -- 'advanced': graduated via the one-way "Advanced settings" action — the
  -- wizard no longer applies, the console is the only editor from here on.
  mode VARCHAR(20) NOT NULL DEFAULT 'simple' CHECK (mode IN ('simple', 'advanced')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calldesk_agent_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID REFERENCES calldesk_agents(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  voice_engine VARCHAR(20) NOT NULL DEFAULT 'retell' CHECK (voice_engine IN ('retell', 'poc')),
  flow_id UUID REFERENCES calldesk_conversation_flows(id) ON DELETE SET NULL,
  retell_agent_id VARCHAR(100),
  retell_llm_id VARCHAR(100),
  voice_id VARCHAR(100),
  tts_backend VARCHAR(20) CHECK (tts_backend IN ('kokoro', 'elevenlabs')),
  -- The wizard's own answers (hours, services, block toggles) that produced
  -- this version — non-null only while the owning agent is still in
  -- 'simple' mode. Never read once mode flips to 'advanced'; kept for
  -- history rather than deleted.
  wizard_config JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (agent_id, version_number)
);

CREATE TABLE IF NOT EXISTS calldesk_phone_numbers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  number VARCHAR(20) NOT NULL UNIQUE,
  -- Nullable outbound matches Retell's own "None (disable outbound)"
  -- default — most numbers never place outbound calls.
  inbound_agent_version_id UUID REFERENCES calldesk_agent_versions(id) ON DELETE SET NULL,
  outbound_agent_version_id UUID REFERENCES calldesk_agent_versions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Re-scope flows/KBs from tenant to agent — a version PINS to one flow_id,
-- but the flow row itself belongs to the agent's lineage (an agent may have
-- several draft/historical flows across its versions).
ALTER TABLE calldesk_conversation_flows ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES calldesk_agents(id) ON DELETE CASCADE;
ALTER TABLE calldesk_knowledge_bases ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES calldesk_agents(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_calldesk_agents_tenant_id ON calldesk_agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calldesk_agent_versions_agent_id ON calldesk_agent_versions(agent_id);
CREATE INDEX IF NOT EXISTS idx_calldesk_phone_numbers_tenant_id ON calldesk_phone_numbers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calldesk_conversation_flows_agent_id ON calldesk_conversation_flows(agent_id);
CREATE INDEX IF NOT EXISTS idx_calldesk_knowledge_bases_agent_id ON calldesk_knowledge_bases(agent_id);

ALTER TABLE calldesk_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_agent_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_phone_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own agents" ON calldesk_agents
  FOR ALL USING (tenant_id IN (SELECT id FROM calldesk_tenants WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can manage own agent versions" ON calldesk_agent_versions
  FOR ALL USING (
    agent_id IN (
      SELECT a.id FROM calldesk_agents a
      JOIN calldesk_tenants t ON a.tenant_id = t.id
      WHERE t.user_id = auth.uid()::text
    )
  );

CREATE POLICY "Users can manage own phone numbers" ON calldesk_phone_numbers
  FOR ALL USING (tenant_id IN (SELECT id FROM calldesk_tenants WHERE user_id = auth.uid()::text));

CREATE TRIGGER update_calldesk_agents_updated_at
  BEFORE UPDATE ON calldesk_agents
  FOR EACH ROW EXECUTE FUNCTION calldesk_update_updated_at_column();

CREATE TRIGGER update_calldesk_phone_numbers_updated_at
  BEFORE UPDATE ON calldesk_phone_numbers
  FOR EACH ROW EXECUTE FUNCTION calldesk_update_updated_at_column();

-- Backfill: promote any existing tenant-inlined "agent" into the new shape
-- as its version 1 — carries over retell_agent_id/retell_llm_id and the
-- settings.voice_engine/voice/tts_backend fields the old model kept on the
-- tenant row directly. Existing phone_number (if any) gets routed to that
-- version's inbound slot; outbound stays unset. Safe to re-run: skips any
-- tenant that already has an agent (idempotent under NOT EXISTS).
DO $$
DECLARE
  t RECORD;
  new_agent_id UUID;
  new_version_id UUID;
BEGIN
  FOR t IN SELECT * FROM calldesk_tenants WHERE NOT EXISTS (
    SELECT 1 FROM calldesk_agents WHERE calldesk_agents.tenant_id = calldesk_tenants.id
  ) LOOP
    INSERT INTO calldesk_agents (tenant_id, name, mode)
    VALUES (t.id, t.name, 'simple')
    RETURNING id INTO new_agent_id;

    INSERT INTO calldesk_agent_versions (
      agent_id, version_number, voice_engine, retell_agent_id, retell_llm_id,
      voice_id, tts_backend
    ) VALUES (
      new_agent_id, 1,
      COALESCE(t.settings->>'voice_engine', 'retell'),
      t.retell_agent_id, t.retell_llm_id,
      t.settings->>'voice',
      NULLIF(t.settings->>'tts_backend', '')
    ) RETURNING id INTO new_version_id;

    UPDATE calldesk_conversation_flows SET agent_id = new_agent_id WHERE tenant_id = t.id AND agent_id IS NULL;
    UPDATE calldesk_knowledge_bases SET agent_id = new_agent_id WHERE tenant_id = t.id AND agent_id IS NULL;

    IF t.phone_number IS NOT NULL THEN
      INSERT INTO calldesk_phone_numbers (tenant_id, number, inbound_agent_version_id)
      VALUES (t.id, t.phone_number, new_version_id)
      ON CONFLICT (number) DO NOTHING;
    END IF;
  END LOOP;
END $$;
