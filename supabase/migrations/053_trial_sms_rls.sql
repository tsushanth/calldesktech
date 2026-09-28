-- Fix: trial_sms_sessions and trial_sms_messages (052_trial_sms_onboarding.sql) were
-- created without RLS, leaving real prospect phone numbers and SMS message content
-- unprotected. Both tables are written and read only by the app's own backend via
-- the service role key (trial onboarding webhook flow) -- there is no end-user-facing
-- query path and no tenant_id/user_id column to key a policy on.
--
-- Admin/service-role data only: RLS enabled, no policies (service role bypasses
-- RLS; anon/authenticated get nothing) -- same shape as 043/044/045
-- (calldesk_outreach_samples / calldesk_outreach_email_events / calldesk_outreach_deck_events).

ALTER TABLE trial_sms_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_sms_messages ENABLE ROW LEVEL SECURITY;
