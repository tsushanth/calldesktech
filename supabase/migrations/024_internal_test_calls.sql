-- Mystery-shopper calls that dial one of our own tenants' real numbers
-- genuinely exercise that tenant's live agent, but shouldn't look
-- indistinguishable from a real customer contact in their call history —
-- shown by default (it's a real call), with an explicit "hide internal
-- calls" filter for anyone who wants a customer-contacts-only view.
ALTER TABLE calldesk_call_logs
  ADD COLUMN IF NOT EXISTS is_internal_test BOOLEAN NOT NULL DEFAULT FALSE;
