-- Inbound-reply webhook: mark a lead as replied without scanning the whole table.
-- Applied to production 2026-09-30 (index built CONCURRENTLY, so it is not part of a transaction here).
--
-- Run separately, outside a transaction:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calldesk_outreach_leads_email_unreplied
--     ON calldesk_outreach_leads (lower(contact_email)) WHERE replied_at IS NULL;

-- Exact, case-insensitive match (the previous ILIKE treated _ and % in addresses as wildcards and
-- forced a full table scan).
CREATE OR REPLACE FUNCTION public.calldesk_mark_replied(p_email text)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH updated AS (
    UPDATE calldesk_outreach_leads
       SET replied_at = now()
     WHERE lower(contact_email) = lower(p_email)
       AND replied_at IS NULL
    RETURNING 1
  )
  SELECT count(*)::int FROM updated;
$$;

REVOKE ALL ON FUNCTION public.calldesk_mark_replied(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calldesk_mark_replied(text) TO service_role;
