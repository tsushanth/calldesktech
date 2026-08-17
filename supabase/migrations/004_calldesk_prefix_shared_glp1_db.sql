-- CallDeskTech schema, prefixed with calldesk_ to share the glp1-platform
-- Supabase project without colliding with glp1's own tables.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS calldesk_tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(20),
  retell_agent_id VARCHAR(100),
  retell_llm_id VARCHAR(100),
  cal_api_key VARCHAR(255),
  cal_event_type_id VARCHAR(100),
  knowledge_base_id VARCHAR(100),
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calldesk_conversation_flows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  nodes JSONB NOT NULL DEFAULT '[]',
  global_settings JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN DEFAULT false,
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calldesk_knowledge_bases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('website', 'pdf', 'manual')),
  source_url TEXT,
  retell_kb_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calldesk_knowledge_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  knowledge_base_id UUID REFERENCES calldesk_knowledge_bases(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calldesk_call_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  retell_call_id VARCHAR(100) NOT NULL,
  caller_phone VARCHAR(20) NOT NULL,
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('booked', 'answered', 'transferred', 'voicemail', 'abandoned')),
  duration_seconds INT DEFAULT 0,
  transcript JSONB,
  extracted_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calldesk_bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  call_log_id UUID REFERENCES calldesk_call_logs(id) ON DELETE SET NULL,
  caller_name VARCHAR(255) NOT NULL,
  caller_email VARCHAR(255),
  caller_phone VARCHAR(20) NOT NULL,
  service_type VARCHAR(100),
  scheduled_time TIMESTAMPTZ NOT NULL,
  cal_booking_id VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- users table: referenced by src/lib/auth.ts's NextAuth signIn callback
-- (upsert on Google sign-in) but was never defined in any prior migration —
-- pre-existing gap, not something this Supabase-project swap introduced.
-- Minimal schema inferred from the upsert call's fields.
CREATE TABLE IF NOT EXISTS calldesk_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  image TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- demo_agents: the table src/app/api/demo-agents/route.ts reads/writes
CREATE TABLE IF NOT EXISTS calldesk_demo_agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id VARCHAR(50) UNIQUE NOT NULL,
  business_name VARCHAR(255) NOT NULL,
  business_type VARCHAR(100) NOT NULL,
  retell_agent_id VARCHAR(100),
  retell_llm_id VARCHAR(100),
  retell_kb_id VARCHAR(100),
  voice_id VARCHAR(100),
  greeting TEXT,
  knowledge_base JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calldesk_tenants_user_id ON calldesk_tenants(user_id);
CREATE INDEX IF NOT EXISTS idx_calldesk_conversation_flows_tenant_id ON calldesk_conversation_flows(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calldesk_knowledge_bases_tenant_id ON calldesk_knowledge_bases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calldesk_call_logs_tenant_id ON calldesk_call_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calldesk_call_logs_created_at ON calldesk_call_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calldesk_bookings_tenant_id ON calldesk_bookings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calldesk_bookings_scheduled_time ON calldesk_bookings(scheduled_time);
CREATE INDEX IF NOT EXISTS idx_calldesk_demo_agents_profile_id ON calldesk_demo_agents(profile_id);

ALTER TABLE calldesk_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_conversation_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_knowledge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_demo_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenants" ON calldesk_tenants
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "Users can insert own tenants" ON calldesk_tenants
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "Users can update own tenants" ON calldesk_tenants
  FOR UPDATE USING (auth.uid()::text = user_id);
CREATE POLICY "Users can delete own tenants" ON calldesk_tenants
  FOR DELETE USING (auth.uid()::text = user_id);

CREATE POLICY "Users can manage own flows" ON calldesk_conversation_flows
  FOR ALL USING (
    tenant_id IN (SELECT id FROM calldesk_tenants WHERE user_id = auth.uid()::text)
  );

CREATE POLICY "Users can manage own knowledge bases" ON calldesk_knowledge_bases
  FOR ALL USING (
    tenant_id IN (SELECT id FROM calldesk_tenants WHERE user_id = auth.uid()::text)
  );

CREATE POLICY "Users can manage own knowledge items" ON calldesk_knowledge_items
  FOR ALL USING (
    knowledge_base_id IN (
      SELECT kb.id FROM calldesk_knowledge_bases kb
      JOIN calldesk_tenants t ON kb.tenant_id = t.id
      WHERE t.user_id = auth.uid()::text
    )
  );

CREATE POLICY "Users can view own call logs" ON calldesk_call_logs
  FOR SELECT USING (
    tenant_id IN (SELECT id FROM calldesk_tenants WHERE user_id = auth.uid()::text)
  );

CREATE POLICY "Users can manage own bookings" ON calldesk_bookings
  FOR ALL USING (
    tenant_id IN (SELECT id FROM calldesk_tenants WHERE user_id = auth.uid()::text)
  );

-- demo_agents and users are read/written via the Supabase service-role key
-- server-side only (no client-side RLS-scoped access pattern in the code),
-- so no per-row policy — service role bypasses RLS entirely regardless.

CREATE OR REPLACE FUNCTION calldesk_update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_calldesk_tenants_updated_at
  BEFORE UPDATE ON calldesk_tenants
  FOR EACH ROW EXECUTE FUNCTION calldesk_update_updated_at_column();

CREATE TRIGGER update_calldesk_conversation_flows_updated_at
  BEFORE UPDATE ON calldesk_conversation_flows
  FOR EACH ROW EXECUTE FUNCTION calldesk_update_updated_at_column();

CREATE TRIGGER update_calldesk_users_updated_at
  BEFORE UPDATE ON calldesk_users
  FOR EACH ROW EXECUTE FUNCTION calldesk_update_updated_at_column();
CREATE TABLE IF NOT EXISTS calldesk_businesses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  subscription_status VARCHAR(20) DEFAULT 'inactive',
  stripe_customer_id VARCHAR(100),
  stripe_subscription_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE calldesk_users ADD COLUMN IF NOT EXISTS default_business_id UUID REFERENCES calldesk_businesses(id);
ALTER TABLE calldesk_businesses ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_calldesk_businesses_updated_at
  BEFORE UPDATE ON calldesk_businesses
  FOR EACH ROW EXECUTE FUNCTION calldesk_update_updated_at_column();
