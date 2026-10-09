-- The browser form finder (harness/outreach/find-forms-browser.ts) reads leads whose contact check found nothing but that have a website.
-- Without this the query scans the whole table and hits the statement timeout. Partial and tiny. Applied to prod with CREATE INDEX CONCURRENTLY.
create index if not exists idx_calldesk_outreach_leads_none_with_domain on public.calldesk_outreach_leads (id)
  where contact_status = 'none' and domain is not null;
