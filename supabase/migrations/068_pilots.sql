-- DRAFT, NOT APPLIED. Additive only: one new table, one marker table, three new nullable/defaulted columns on calldesk_tenants.
--
-- A pilot is a free trial for a design partner: one week, capped at minutes_cap of talk time, no card. Monitoring (admin page, hourly
-- watch cron, weekly report) reads this table plus calldesk_call_logs. See docs/pilot-cap-enforcement.md for how the voice engine uses
-- calldesk_tenants.pilot_blocked.
CREATE TABLE IF NOT EXISTS calldesk_pilots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  contact_name TEXT,
  contact_email TEXT,
  company TEXT,
  vertical TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  minutes_cap NUMERIC NOT NULL DEFAULT 50 CHECK (minutes_cap > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'capped', 'expired', 'converted', 'stopped')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ends_at defaults to started_at + 7 days (a column default cannot reference another column, so a trigger fills it when omitted).
CREATE OR REPLACE FUNCTION calldesk_pilots_default_ends_at() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ends_at IS NULL THEN
    NEW.ends_at := NEW.started_at + INTERVAL '7 days';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS calldesk_pilots_default_ends_at_trg ON calldesk_pilots;
CREATE TRIGGER calldesk_pilots_default_ends_at_trg
  BEFORE INSERT ON calldesk_pilots
  FOR EACH ROW EXECUTE FUNCTION calldesk_pilots_default_ends_at();

CREATE INDEX IF NOT EXISTS idx_calldesk_pilots_status ON calldesk_pilots(status);

-- Sent-email markers: one row per alert actually sent, so the hourly cron never repeats one. event_key embeds the pilot id
-- (e.g. '<pilot uuid>:cap_80', '<pilot uuid>:failed_call:<call uuid>', 'weekly:2026-10-05').
CREATE TABLE IF NOT EXISTS calldesk_pilot_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_id UUID REFERENCES calldesk_pilots(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL UNIQUE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calldesk_pilot_events_pilot ON calldesk_pilot_events(pilot_id);

-- Flag the voice engine reads at call setup; maintained by the pilot-watch cron and the admin pilot API.
ALTER TABLE calldesk_tenants
  ADD COLUMN IF NOT EXISTS pilot_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pilot_blocked_reason TEXT,
  ADD COLUMN IF NOT EXISTS pilot_blocked_at TIMESTAMPTZ;

-- Admin-only data, same as the outreach tables: RLS on with no policies. Only the service role (the web app's server routes) reads or writes.
ALTER TABLE calldesk_pilots ENABLE ROW LEVEL SECURITY;
ALTER TABLE calldesk_pilot_events ENABLE ROW LEVEL SECURITY;
