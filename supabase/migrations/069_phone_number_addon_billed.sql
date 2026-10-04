-- Premium phone numbers add-on (src/lib/numberAddOn.ts). NOT yet applied: apply before deploying the web app.
--
-- addon_billed marks a purchased number that was bought under the paid add-on (Lite/Standard): it counts toward the monthly Stripe item's
-- quantity and its inbound calls are reported to the number inbound meter. Default false, so every existing number, every number bought by a
-- Pro or legacy tenant, and every ported (bring-your-own) number stays unbilled. Additive and nullable-safe; can stay in place on rollback.
ALTER TABLE calldesk_phone_numbers ADD COLUMN IF NOT EXISTS addon_billed BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_calldesk_phone_numbers_addon_billed ON calldesk_phone_numbers (tenant_id) WHERE addon_billed;
