-- Demo links can offer the visitor a choice of voices (for example a New Zealand and an Australian voice) before the call starts.
-- A JSON array of { key, label, detail?, voice_id } (see parseVoiceOptions in src/lib/demoLinks.ts). NULL = no picker, the agent's own voice.
ALTER TABLE calldesk_demo_links ADD COLUMN IF NOT EXISTS voice_options jsonb;
