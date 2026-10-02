-- The pool of outbound numbers the hired callers dial from. The line picks one per call (least used today,
-- preferring a matching area code) and stops using a number once it reaches daily_cap, so no single number
-- carries enough volume to be flagged. Empty pool = the caller's own caller_id is used, as before.
CREATE TABLE IF NOT EXISTS calldesk_outbound_numbers (
  phone TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  -- Area codes of the people this number should be preferred for (a local-looking number is answered more).
  area_codes TEXT[] NOT NULL DEFAULT '{}',
  daily_cap INT NOT NULL DEFAULT 75 CHECK (daily_cap > 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE calldesk_outbound_numbers ENABLE ROW LEVEL SECURITY;
