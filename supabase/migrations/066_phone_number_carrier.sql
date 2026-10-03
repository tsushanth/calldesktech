-- Applied to production on 2026-10-02 via the Supabase console; kept here for the record.
-- The migration was first documented in the engine repo.
alter table calldesk_phone_numbers add column if not exists carrier text check (carrier is null or carrier in ('twilio','telnyx'));
comment on column calldesk_phone_numbers.carrier is 'Voice carrier serving this number; null is treated as twilio.';
