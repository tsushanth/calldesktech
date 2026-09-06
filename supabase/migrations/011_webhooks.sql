-- Outbound webhooks: let a tenant register HTTP endpoints that CallDesk POSTs
-- to whenever one of their calls reaches a subscribed outcome (e.g. a call
-- completes, or gets transferred to a human). This is the first REAL
-- integration on the Integrations page — Slack/Zapier/HubSpot are still
-- "coming soon" placeholders there.
--
-- Each row carries its own `secret`: every delivery is signed with
-- HMAC-SHA256 over the exact JSON body and sent in an X-CallDesk-Signature
-- header, so the receiver can verify the payload really came from us and
-- wasn't tampered with — the same createHmac('sha256', secret) construction
-- the realtime-tts gateway uses for its session tokens, and that Stripe uses
-- for its own webhook signatures.

CREATE TABLE IF NOT EXISTS calldesk_webhooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  -- Which call events this endpoint wants. Values are dotted event names like
  -- 'call.completed' / 'call.transferred' — see WEBHOOK_EVENTS in
  -- src/lib/webhooks.ts for the authoritative list. A delivery fires only for
  -- an endpoint whose events[] contains the event being emitted.
  events TEXT[] NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  -- Per-endpoint signing secret (plaintext: we need it to sign each outgoing
  -- delivery, and the tenant needs to see it once to configure verification
  -- on their side). Generated server-side as 'whsec_' + random hex.
  secret TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calldesk_webhooks_tenant_id ON calldesk_webhooks(tenant_id);

ALTER TABLE calldesk_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own webhooks" ON calldesk_webhooks
  FOR ALL USING (tenant_id IN (SELECT id FROM calldesk_tenants WHERE user_id = auth.uid()::text));

CREATE TRIGGER update_calldesk_webhooks_updated_at
  BEFORE UPDATE ON calldesk_webhooks
  FOR EACH ROW EXECUTE FUNCTION calldesk_update_updated_at_column();
