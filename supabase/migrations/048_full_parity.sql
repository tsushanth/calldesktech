-- Feature parity extension: inbound SMS, voice management, number porting,
-- and Stripe-accurate usage.

-- =============================================
-- 1) Phone number source tracking (porting)
-- =============================================
ALTER TABLE calldesk_phone_numbers
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'purchased' CHECK (source IN ('purchased', 'ported')),
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- =============================================
-- 2) SMS threading + inbound support
-- =============================================
ALTER TABLE calldesk_sms_messages
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'telnyx';
