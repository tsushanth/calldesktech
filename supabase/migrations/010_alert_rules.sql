-- Alerting — matches Retell's "Alerts" feature: a tenant configures rules
-- like "email me when a call gets transferred" or "…abandoned", and the
-- webhook that finalizes a call's outcome sends those emails when a matching
-- rule fires (see src/lib/alerts.ts + src/app/api/webhooks/retell/route.ts).
--
-- One row = one rule. trigger_type is intentionally the same vocabulary as
-- calldesk_call_logs.outcome's non-success values, so firing is a plain
-- equality check between a finalized call's outcome and enabled rules.

CREATE TABLE IF NOT EXISTS calldesk_alert_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  -- Which finalized call outcome fires this rule. Mirrors the outcome enum
  -- on calldesk_call_logs (minus the "success" outcomes booked/answered,
  -- which aren't things you'd alert on).
  trigger_type VARCHAR(20) NOT NULL CHECK (trigger_type IN ('transferred', 'abandoned', 'voicemail')),
  email VARCHAR(320) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- A tenant doesn't need two identical rules to the same address for the
  -- same trigger — collapse those into one.
  UNIQUE (tenant_id, trigger_type, email)
);

CREATE INDEX IF NOT EXISTS idx_calldesk_alert_rules_tenant_id ON calldesk_alert_rules(tenant_id);
-- The webhook's hot path: "enabled rules for this tenant + this outcome".
CREATE INDEX IF NOT EXISTS idx_calldesk_alert_rules_lookup
  ON calldesk_alert_rules(tenant_id, trigger_type) WHERE enabled;

ALTER TABLE calldesk_alert_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own alert rules" ON calldesk_alert_rules
  FOR ALL USING (tenant_id IN (SELECT id FROM calldesk_tenants WHERE user_id = auth.uid()::text));

CREATE TRIGGER update_calldesk_alert_rules_updated_at
  BEFORE UPDATE ON calldesk_alert_rules
  FOR EACH ROW EXECUTE FUNCTION calldesk_update_updated_at_column();
