-- Automated agency discovery + approval-gated outreach. Additive only: new
-- columns on calldesk_outreach_leads (created in 015) and three new tables.
-- Admin-only data, gated at the application layer, so no RLS policies.

ALTER TABLE calldesk_outreach_leads
  ADD COLUMN IF NOT EXISTS source_key TEXT,
  ADD COLUMN IF NOT EXISTS tier TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS score INTEGER,
  ADD COLUMN IF NOT EXISTS region_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contact_status VARCHAR(20) NOT NULL DEFAULT 'unknown'
    CHECK (contact_status IN ('unknown', 'found', 'form_only', 'none')),
  ADD COLUMN IF NOT EXISTS contact_source_url TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;

-- Discovery adds leads from the Retell partner directory; allow that source.
ALTER TABLE calldesk_outreach_leads DROP CONSTRAINT IF EXISTS calldesk_outreach_leads_signal_source_check;
ALTER TABLE calldesk_outreach_leads ADD CONSTRAINT calldesk_outreach_leads_signal_source_check
  CHECK (signal_source IN ('job_posting', 'review_site', 'tech_fingerprint', 'manual', 'directory'));

-- Dedup at the database level: one row per directory identity and per website.
CREATE UNIQUE INDEX IF NOT EXISTS idx_calldesk_outreach_leads_source_key
  ON calldesk_outreach_leads(source_key) WHERE source_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_calldesk_outreach_leads_domain
  ON calldesk_outreach_leads(lower(domain)) WHERE domain IS NOT NULL;

CREATE TABLE IF NOT EXISTS calldesk_outreach_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES calldesk_outreach_leads(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'sent', 'failed', 'rejected')),
  error TEXT,
  resend_id TEXT,
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calldesk_outreach_messages_status ON calldesk_outreach_messages(status);
CREATE INDEX IF NOT EXISTS idx_calldesk_outreach_messages_lead ON calldesk_outreach_messages(lead_id);
-- At most one live (non-rejected) message per lead: a lead is never drafted or emailed twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_calldesk_outreach_messages_lead_once
  ON calldesk_outreach_messages(lead_id) WHERE status <> 'rejected';

CREATE TABLE IF NOT EXISTS calldesk_outreach_suppressions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calldesk_outreach_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  leads_seen INTEGER NOT NULL DEFAULT 0,
  leads_new INTEGER NOT NULL DEFAULT 0,
  contacts_found INTEGER NOT NULL DEFAULT 0,
  drafts_created INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_calldesk_outreach_runs_started ON calldesk_outreach_runs(started_at);
