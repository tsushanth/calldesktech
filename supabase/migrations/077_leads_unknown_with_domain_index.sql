-- Browser form finder, second pool: leads never contact-checked that have a website. Applied to prod with CREATE INDEX CONCURRENTLY.
create index if not exists idx_calldesk_outreach_leads_unknown_with_domain on public.calldesk_outreach_leads (id)
  where contact_status = 'unknown' and domain is not null;
