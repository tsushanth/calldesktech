-- Contacts: a per-caller record layered over calldesk_call_logs. The list of
-- distinct callers is DERIVED at read-time from the call logs (no separate
-- ingestion or call-tracking needed) — this table only persists what a user
-- can actually SET on a contact, which today is just the Do Not Call flag.
--
-- A row is created lazily: the first time someone toggles a number's DNC we
-- upsert it here. Absence of a row therefore means do_not_call = false (the
-- default), so the derived contacts list stays correct for numbers nobody has
-- touched yet. UNIQUE (tenant_id, caller_phone) is what the upsert conflicts on.

CREATE TABLE IF NOT EXISTS calldesk_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  caller_phone VARCHAR(20) NOT NULL,
  do_not_call BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, caller_phone)
);

CREATE INDEX IF NOT EXISTS idx_calldesk_contacts_tenant_id ON calldesk_contacts(tenant_id);

ALTER TABLE calldesk_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own contacts" ON calldesk_contacts
  FOR ALL USING (tenant_id IN (SELECT id FROM calldesk_tenants WHERE user_id = auth.uid()::text));

CREATE TRIGGER update_calldesk_contacts_updated_at
  BEFORE UPDATE ON calldesk_contacts
  FOR EACH ROW EXECUTE FUNCTION calldesk_update_updated_at_column();
