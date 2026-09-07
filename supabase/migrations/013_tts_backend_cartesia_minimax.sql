-- Widens calldesk_agent_versions.tts_backend to accept two new in-house
-- ('poc' engine) TTS backends: cartesia and minimax. Both are real,
-- implemented backends in call-loop-poc/server.js (parallel to the existing
-- kokoro/elevenlabs ones), each calling that provider's API directly with
-- its own key set on the call-loop-poc Fly app. Not yet wired to a Stripe
-- usage price (see USAGE_PRICES.voice in src/lib/constants.ts) — that's a
-- real billing decision made once there's an account and a confirmed rate,
-- not invented here.

ALTER TABLE calldesk_agent_versions DROP CONSTRAINT IF EXISTS calldesk_agent_versions_tts_backend_check;
ALTER TABLE calldesk_agent_versions
  ADD CONSTRAINT calldesk_agent_versions_tts_backend_check
  CHECK (tts_backend IN ('kokoro', 'elevenlabs', 'cartesia', 'minimax'));
