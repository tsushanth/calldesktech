-- Audio playback for the Calls detail page. recording_url was already typed
-- on the frontend (src/types/index.ts) but the column never existed, and
-- even where the Retell webhook DID receive a recording_url in its payload,
-- it was only ever forwarded to the tenant's own outbound webhooks — never
-- persisted here. voice_engine/to_number/direction distinguish a poc-engine
-- row (logged directly by call-loop-poc, which owns its own telephony
-- lifecycle) from a Retell-engine row (logged via Retell's webhook).
ALTER TABLE calldesk_call_logs
  ADD COLUMN IF NOT EXISTS recording_url TEXT,
  ADD COLUMN IF NOT EXISTS voice_engine VARCHAR(10),
  ADD COLUMN IF NOT EXISTS to_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS direction VARCHAR(10);
