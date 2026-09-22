-- Second product on the outreach-discovery harness: readaloudai.org
-- (realtime TTS/STT API). Mirrors the final calldesk_outreach_* schema
-- (015, 029, 030, 031, 033, 034, 041) exactly, under a separate
-- readaloud_outreach_* prefix -- a fully separate set of tables rather than
-- a shared `product` column, so each product's leads/runs/messages/
-- suppressions are isolated end to end. Admin-only data, gated at the
-- application layer, so no RLS policies (same as calldesk_outreach_*).

CREATE TABLE IF NOT EXISTS readaloud_outreach_leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name TEXT NOT NULL,
  domain TEXT,
  contact_email TEXT,
  signal_source VARCHAR(20) NOT NULL CHECK (signal_source IN ('job_posting', 'review_site', 'tech_fingerprint', 'manual', 'directory', 'search')),
  signal_detail TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'report_generated', 'sent', 'replied', 'dead')),
  report_html TEXT,
  report_text TEXT,
  report_subject TEXT,
  source_key TEXT,
  tier TEXT,
  location TEXT,
  description TEXT,
  score INTEGER,
  region_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  contact_status VARCHAR(20) NOT NULL DEFAULT 'unknown'
    CHECK (contact_status IN ('unknown', 'found', 'form_only', 'none')),
  contact_source_url TEXT,
  last_seen_at TIMESTAMPTZ,
  enriched_at TIMESTAMPTZ,
  research JSONB,
  researched_at TIMESTAMPTZ,
  fit VARCHAR(10) CHECK (fit IN ('high', 'medium', 'low', 'unclear')),
  signals JSONB,
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_readaloud_outreach_leads_source_key
  ON readaloud_outreach_leads(source_key) WHERE source_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_readaloud_outreach_leads_domain
  ON readaloud_outreach_leads(lower(domain)) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_readaloud_outreach_leads_status ON readaloud_outreach_leads(status);

CREATE TABLE IF NOT EXISTS readaloud_outreach_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES readaloud_outreach_leads(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'sent', 'failed', 'rejected')),
  error TEXT,
  resend_id TEXT,
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  step INT NOT NULL DEFAULT 1,
  translation_subject TEXT,
  translation_body TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_readaloud_outreach_messages_status ON readaloud_outreach_messages(status);
CREATE INDEX IF NOT EXISTS idx_readaloud_outreach_messages_lead ON readaloud_outreach_messages(lead_id);
-- At most one live (non-rejected) message per lead PER STEP: an initial email
-- plus follow-up steps are allowed, but a given step is drafted/sent once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_readaloud_outreach_messages_lead_step_once
  ON readaloud_outreach_messages(lead_id, step) WHERE status <> 'rejected';

CREATE TABLE IF NOT EXISTS readaloud_outreach_suppressions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS readaloud_outreach_runs (
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

CREATE INDEX IF NOT EXISTS idx_readaloud_outreach_runs_started ON readaloud_outreach_runs(started_at);
