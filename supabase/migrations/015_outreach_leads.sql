-- Internal-only outreach tooling: a lead list of companies showing public
-- signals of running voice-AI/Retell, plus a structured store of
-- mystery-shopper benchmark results (previously only ever printed to a
-- terminal by call-loop-poc/scripts/mystery-shopper-judge.mjs) so a
-- personalized comparison report can cite real numbers instead of inventing
-- them. No tenant/RLS scoping — this is admin-only data, gated at the
-- application layer (ADMIN_EMAILS allowlist), not per-customer data.

CREATE TABLE IF NOT EXISTS calldesk_outreach_leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name TEXT NOT NULL,
  domain TEXT,
  contact_email TEXT,
  signal_source VARCHAR(20) NOT NULL CHECK (signal_source IN ('job_posting', 'review_site', 'tech_fingerprint', 'manual')),
  signal_detail TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'report_generated', 'sent', 'replied', 'dead')),
  report_html TEXT,
  report_text TEXT,
  report_subject TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calldesk_benchmark_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_at TIMESTAMPTZ NOT NULL,
  our_latency_ms INTEGER,
  retell_latency_ms INTEGER,
  winner VARCHAR(20) CHECK (winner IN ('ours', 'retell', 'tie', 'unknown')),
  judge_summary TEXT,
  transcript_a TEXT,
  transcript_b TEXT,
  source_run_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calldesk_outreach_leads_status ON calldesk_outreach_leads(status);
CREATE INDEX IF NOT EXISTS idx_calldesk_benchmark_runs_run_at ON calldesk_benchmark_runs(run_at);
