-- Fix: transcript_search was only backfilled ONCE in migration 049, with no
-- trigger/generated-column mechanism to keep it in sync. Every call log
-- inserted or updated (new transcript content) after 049 ran has a stale or
-- NULL transcript_search, so the full-text search in
-- src/app/api/tenants/[id]/calls/route.ts silently misses those calls.
--
-- `transcript` on calldesk_call_logs is JSONB (see migration
-- 004_calldesk_prefix_shared_glp1_db.sql), and to_tsvector(regconfig, text)
-- is STABLE, not IMMUTABLE, in Postgres — so it cannot be used in a
-- GENERATED ALWAYS AS (...) STORED column (Postgres requires the generation
-- expression to be IMMUTABLE). A BEFORE INSERT/UPDATE trigger is therefore
-- the correct mechanism here, not a generated column.

CREATE OR REPLACE FUNCTION calldesk_call_logs_transcript_search_trigger()
RETURNS TRIGGER AS $$
BEGIN
  NEW.transcript_search := to_tsvector('english', COALESCE(NEW.transcript::text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calldesk_call_logs_transcript_search ON calldesk_call_logs;

CREATE TRIGGER trg_calldesk_call_logs_transcript_search
  BEFORE INSERT OR UPDATE OF transcript ON calldesk_call_logs
  FOR EACH ROW
  EXECUTE FUNCTION calldesk_call_logs_transcript_search_trigger();

-- One-time catch-up backfill for any rows inserted/updated since 049 ran
-- whose transcript_search is stale or missing. Idempotent: recomputes the
-- exact same expression the trigger now maintains going forward, so it is
-- safe to re-run.
UPDATE calldesk_call_logs
SET transcript_search = to_tsvector('english', COALESCE(transcript::text, ''))
WHERE transcript IS NOT NULL
  AND (
    transcript_search IS NULL
    OR transcript_search <> to_tsvector('english', COALESCE(transcript::text, ''))
  );
