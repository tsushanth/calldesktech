-- Pitch-deck views, recorded the same way as sample-call views.
--
-- The deck page (/deck) shipped PostHog-only: the ?t= token survived solely inside
-- $current_url, so a deck view could not be joined to its message in SQL and the
-- token -> message mapping needed a server-side HMAC that a PostHog query cannot
-- do. Now the deck verifies the token and posts here, so deck views sit in the
-- same funnel as every other signal.
--
-- Admin/service-role data only: RLS enabled, no policies (service role bypasses
-- RLS; anon/authenticated get nothing) — same shape as 043/044.
CREATE TABLE IF NOT EXISTS calldesk_outreach_deck_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES calldesk_outreach_messages(id) ON DELETE SET NULL,
  product TEXT NOT NULL,
  event TEXT NOT NULL,
  is_bot BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calldesk_outreach_deck_events_message ON calldesk_outreach_deck_events(message_id);
CREATE INDEX IF NOT EXISTS idx_calldesk_outreach_deck_events_product ON calldesk_outreach_deck_events(product, created_at DESC);
ALTER TABLE calldesk_outreach_deck_events ENABLE ROW LEVEL SECURITY;

-- NOT in this file, because CREATE INDEX CONCURRENTLY cannot run inside a transaction and
-- migration runners wrap the file in one:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calldesk_outreach_leads_product_id
--     ON calldesk_outreach_leads (product, id);
--
-- Run it by hand (it is already applied on the live project). Without it the keyset dedupe scan
-- still works but falls back to a per-page sort of the product's whole lead set, which is what
-- caused the statement timeouts. With it, page 84 of the 84k-row homeservices set reads 1,010
-- buffers instead of 84,596.
