-- Real calendar booking (Cal.com) — see the 2026-09-17 design notes.
-- One connection per tenant; call-loop-poc's check_availability/
-- book_appointment tools read this via tenantLookup.js, the same place
-- ttsBackend/stripeCustomerId/etc. are already resolved per-call.
CREATE TABLE IF NOT EXISTS calldesk_calendar_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES calldesk_tenants(id) ON DELETE CASCADE UNIQUE,
  provider VARCHAR(20) NOT NULL DEFAULT 'cal.com' CHECK (provider IN ('cal.com')),
  api_key TEXT NOT NULL,
  event_type_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE calldesk_calendar_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own calendar connections" ON calldesk_calendar_connections
  FOR ALL USING (
    tenant_id IN (SELECT id FROM calldesk_tenants WHERE user_id = auth.uid()::text)
  );
