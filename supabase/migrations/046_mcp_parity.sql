-- MCP parity: add tables/columns for tools that were exposed in MCP but had
-- no backend API. This migration makes every MCP tool real.

-- =============================================
-- 1) Expand calldesk_contacts into a real address book
-- =============================================
ALTER TABLE calldesk_contacts
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Existing rows (DNC-only upserts) will have NULL name/email/notes.
-- The contact list API falls back to caller_phone when name is NULL so
-- legacy rows remain usable.

-- =============================================
-- 2) SMS messages (inbound + outbound)
-- =============================================
CREATE TABLE IF NOT EXISTS calldesk_sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  phone_number_id UUID REFERENCES calldesk_phone_numbers(id) ON DELETE SET NULL,
  from_number VARCHAR(20) NOT NULL,
  to_number VARCHAR(20) NOT NULL,
  body TEXT NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'sent', 'delivered', 'failed', 'received')),
  provider_sid VARCHAR(100), -- Twilio MessageSid for reconciliation
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calldesk_sms_tenant_id ON calldesk_sms_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calldesk_sms_created_at ON calldesk_sms_messages(created_at DESC);

ALTER TABLE calldesk_sms_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own SMS" ON calldesk_sms_messages
  FOR ALL USING (tenant_id IN (SELECT id FROM calldesk_tenants WHERE user_id = auth.uid()::text));

CREATE TRIGGER update_calldesk_sms_updated_at
  BEFORE UPDATE ON calldesk_sms_messages
  FOR EACH ROW EXECUTE FUNCTION calldesk_update_updated_at_column();

-- =============================================
-- 3) Voices (per-tenant library — seeded from static config on first read,
-- editable by the user so they can rename voices or set favorites)
-- =============================================
CREATE TABLE IF NOT EXISTS calldesk_voices (
  id TEXT PRIMARY KEY, -- e.g. "11labs-Adrian", "kokoro-af", "retell-Brian"
  tenant_id UUID NOT NULL REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  gender TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  accent TEXT,
  engine TEXT NOT NULL CHECK (engine IN ('poc', 'retell')),
  tts_backend TEXT CHECK (tts_backend IN ('kokoro', 'elevenlabs', 'cartesia', 'minimax')),
  sample_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_calldesk_voices_tenant_id ON calldesk_voices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calldesk_voices_engine ON calldesk_voices(tenant_id, engine);

ALTER TABLE calldesk_voices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own voices" ON calldesk_voices
  FOR ALL USING (tenant_id IN (SELECT id FROM calldesk_tenants WHERE user_id = auth.uid()::text));

CREATE TRIGGER update_calldesk_voices_updated_at
  BEFORE UPDATE ON calldesk_voices
  FOR EACH ROW EXECUTE FUNCTION calldesk_update_updated_at_column();
