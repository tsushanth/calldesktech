-- Global + per-tenant CPS rate limiting for outbound call placement
-- (2026-09-17) — batch calling used to place calls in a plain sequential
-- loop with no rate limiting at all. Real risk at scale: Twilio and Retell
-- are each ONE SHARED ACCOUNT across every tenant, not per-tenant
-- credentials, so two tenants' batches running at once could together blow
-- through the account's real CPS/concurrency limit even if each batch looks
-- fine individually. A per-tenant-only limiter wouldn't catch that — this
-- needs a genuinely global, cross-process token bucket (both calldesktech
-- and call-loop-poc place real calls, on separate Fly apps with multiple
-- machines each, so in-memory state isn't safe here regardless).
--
-- Single reusable primitive: caller supplies capacity/refill_per_sec every
-- call (not stored server-side), so tuning the actual rate is just a
-- constant change in code, no migration needed. Same function serves both
-- a global key ("twilio-global") and a per-tenant key
-- ("twilio-tenant-<id>") — the row is created lazily on first use.
CREATE TABLE IF NOT EXISTS calldesk_rate_limiters (
  provider_key VARCHAR(120) PRIMARY KEY,
  tokens NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION calldesk_try_acquire_token(
  p_key VARCHAR,
  p_capacity NUMERIC,
  p_refill_per_sec NUMERIC,
  p_cost NUMERIC DEFAULT 1
) RETURNS BOOLEAN AS $$
DECLARE
  v_tokens NUMERIC;
  v_updated TIMESTAMPTZ;
  v_elapsed NUMERIC;
  v_new_tokens NUMERIC;
BEGIN
  INSERT INTO calldesk_rate_limiters (provider_key, tokens, updated_at)
    VALUES (p_key, p_capacity, NOW())
    ON CONFLICT (provider_key) DO NOTHING;

  -- Row lock serializes concurrent acquirers on the SAME key across every
  -- process/machine hitting this same Postgres row — this is the actual
  -- cross-instance safety mechanism, not application-level coordination.
  SELECT tokens, updated_at INTO v_tokens, v_updated
    FROM calldesk_rate_limiters
    WHERE provider_key = p_key
    FOR UPDATE;

  v_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (NOW() - v_updated)));
  -- Capped at p_capacity even if the caller's config changed since this row
  -- was created — a capacity DECREASE takes effect immediately, an increase
  -- takes effect on the next full refill, never negative/stale either way.
  v_new_tokens := LEAST(p_capacity, v_tokens + v_elapsed * p_refill_per_sec);

  IF v_new_tokens >= p_cost THEN
    UPDATE calldesk_rate_limiters SET tokens = v_new_tokens - p_cost, updated_at = NOW() WHERE provider_key = p_key;
    RETURN TRUE;
  ELSE
    UPDATE calldesk_rate_limiters SET tokens = v_new_tokens, updated_at = NOW() WHERE provider_key = p_key;
    RETURN FALSE;
  END IF;
END;
$$ LANGUAGE plpgsql;
