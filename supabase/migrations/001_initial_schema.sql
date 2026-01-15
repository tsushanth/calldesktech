-- CallDeskTech Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tenants table (businesses using the platform)
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL, -- Supabase Auth user ID
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

-- Conversation flows
CREATE TABLE conversation_flows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  nodes JSONB NOT NULL DEFAULT '[]',
  global_settings JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN DEFAULT false,
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Knowledge bases
CREATE TABLE knowledge_bases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('website', 'pdf', 'manual')),
  source_url TEXT,
  retell_kb_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Knowledge items (Q&A pairs)
CREATE TABLE knowledge_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  knowledge_base_id UUID REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Call logs
CREATE TABLE call_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  retell_call_id VARCHAR(100) NOT NULL,
  caller_phone VARCHAR(20) NOT NULL,
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('booked', 'answered', 'transferred', 'voicemail', 'abandoned')),
  duration_seconds INT DEFAULT 0,
  transcript JSONB,
  extracted_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bookings
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  call_log_id UUID REFERENCES call_logs(id) ON DELETE SET NULL,
  caller_name VARCHAR(255) NOT NULL,
  caller_email VARCHAR(255),
  caller_phone VARCHAR(20) NOT NULL,
  service_type VARCHAR(100),
  scheduled_time TIMESTAMPTZ NOT NULL,
  cal_booking_id VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_tenants_user_id ON tenants(user_id);
CREATE INDEX idx_conversation_flows_tenant_id ON conversation_flows(tenant_id);
CREATE INDEX idx_knowledge_bases_tenant_id ON knowledge_bases(tenant_id);
CREATE INDEX idx_call_logs_tenant_id ON call_logs(tenant_id);
CREATE INDEX idx_call_logs_created_at ON call_logs(created_at DESC);
CREATE INDEX idx_bookings_tenant_id ON bookings(tenant_id);
CREATE INDEX idx_bookings_scheduled_time ON bookings(scheduled_time);

-- Row Level Security (RLS)
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tenants
CREATE POLICY "Users can view own tenants" ON tenants
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert own tenants" ON tenants
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Users can update own tenants" ON tenants
  FOR UPDATE USING (auth.uid()::text = user_id);

CREATE POLICY "Users can delete own tenants" ON tenants
  FOR DELETE USING (auth.uid()::text = user_id);

-- RLS Policies for conversation_flows
CREATE POLICY "Users can manage own flows" ON conversation_flows
  FOR ALL USING (
    tenant_id IN (SELECT id FROM tenants WHERE user_id = auth.uid()::text)
  );

-- RLS Policies for knowledge_bases
CREATE POLICY "Users can manage own knowledge bases" ON knowledge_bases
  FOR ALL USING (
    tenant_id IN (SELECT id FROM tenants WHERE user_id = auth.uid()::text)
  );

-- RLS Policies for knowledge_items
CREATE POLICY "Users can manage own knowledge items" ON knowledge_items
  FOR ALL USING (
    knowledge_base_id IN (
      SELECT kb.id FROM knowledge_bases kb
      JOIN tenants t ON kb.tenant_id = t.id
      WHERE t.user_id = auth.uid()::text
    )
  );

-- RLS Policies for call_logs
CREATE POLICY "Users can view own call logs" ON call_logs
  FOR SELECT USING (
    tenant_id IN (SELECT id FROM tenants WHERE user_id = auth.uid()::text)
  );

-- RLS Policies for bookings
CREATE POLICY "Users can manage own bookings" ON bookings
  FOR ALL USING (
    tenant_id IN (SELECT id FROM tenants WHERE user_id = auth.uid()::text)
  );

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at trigger
CREATE TRIGGER update_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversation_flows_updated_at
  BEFORE UPDATE ON conversation_flows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
