-- GET /api/admin/outreach/leads orders ~560k leads by created_at with no supporting index, so every request sorted the whole
-- table and hit the statement timeout. Already applied to production with CREATE INDEX CONCURRENTLY (not allowed inside a
-- migration transaction); IF NOT EXISTS makes this a no-op there and creates it on a fresh database.
CREATE INDEX IF NOT EXISTS idx_calldesk_outreach_leads_created_at
  ON public.calldesk_outreach_leads (created_at DESC);
