-- HighLevel workflow trigger subscriptions: one row per workflow that uses the "Calldesk call completed" trigger.
-- Each subscription owns a calldesk_webhooks row (format 'flat', event call.completed) whose URL is the HighLevel trigger
-- execute URL, so the existing signed, retried webhook delivery does the sending. Service role only: RLS on, no policies.
CREATE TABLE IF NOT EXISTS calldesk_highlevel_trigger_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id text NOT NULL,
  hl_trigger_id text NOT NULL,
  trigger_key text NOT NULL,
  target_url text NOT NULL,
  webhook_id uuid REFERENCES calldesk_webhooks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, hl_trigger_id)
);
CREATE INDEX IF NOT EXISTS calldesk_highlevel_trigger_subscriptions_location_idx ON calldesk_highlevel_trigger_subscriptions (location_id);
ALTER TABLE calldesk_highlevel_trigger_subscriptions ENABLE ROW LEVEL SECURITY;
