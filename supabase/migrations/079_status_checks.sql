-- Public status page (/status): real probe results plus manually written incidents.
--
-- Both tables have RLS ENABLED and deliberately NO policies: anon and authenticated roles can read
-- and write nothing. Only the service role (which bypasses RLS) writes probe results from
-- POST /api/status/probe and reads them for /status and /api/status. Incident text is public by
-- design, but it is still served through the server, never straight from the database.

CREATE TABLE IF NOT EXISTS calldesk_status_checks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  component TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('operational', 'degraded', 'down')),
  http_code INTEGER,
  latency_ms INTEGER,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calldesk_status_checks_component_checked_at
  ON calldesk_status_checks (component, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_calldesk_status_checks_checked_at
  ON calldesk_status_checks (checked_at);

ALTER TABLE calldesk_status_checks ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS calldesk_status_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  body TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calldesk_status_incidents_started_at
  ON calldesk_status_incidents (started_at DESC);

ALTER TABLE calldesk_status_incidents ENABLE ROW LEVEL SECURITY;

-- Per component per UTC day, how many checks had each status. The server folds these into
-- "worst status of the day". Doing the GROUP BY here avoids pulling ~130k raw rows per page render.
CREATE OR REPLACE FUNCTION calldesk_status_daily(since TIMESTAMPTZ)
RETURNS TABLE (component TEXT, day DATE, status TEXT, n BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT c.component, (c.checked_at AT TIME ZONE 'UTC')::date AS day, c.status, COUNT(*) AS n
  FROM calldesk_status_checks c
  WHERE c.checked_at >= since
  GROUP BY 1, 2, 3
$$;

REVOKE ALL ON FUNCTION calldesk_status_daily(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION calldesk_status_daily(TIMESTAMPTZ) TO service_role;
