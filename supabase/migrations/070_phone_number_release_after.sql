-- Release of purchased numbers after a cancellation (src/lib/numberRelease.ts). NOT yet applied: apply before deploying the web app.
--
-- release_after is set (now + a 14 day grace period) on every number we sold a tenant when its subscription is deleted, and cleared when
-- the tenant subscribes again. A daily job releases the numbers whose release_after has passed. NULL (the default) means "keep": every
-- existing number, every number a tenant brought itself, and every number of an active tenant. Additive and nullable; can stay on rollback.
ALTER TABLE calldesk_phone_numbers ADD COLUMN IF NOT EXISTS release_after TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_calldesk_phone_numbers_release_after ON calldesk_phone_numbers (release_after) WHERE release_after IS NOT NULL;
