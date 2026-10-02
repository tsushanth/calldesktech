-- Per-agent-version model choice. Both nullable: NULL means "use the engine default" (Claude Haiku 4.5 for the language model, the
-- voice backend's default model for speech), so every existing version keeps behaving exactly as before.
-- The allowed values live in code (src/lib/modelCatalog.ts, validated by the publish-version route); the CHECKs only stop junk.
ALTER TABLE calldesk_agent_versions
  ADD COLUMN IF NOT EXISTS llm_model VARCHAR(80) CHECK (llm_model IS NULL OR llm_model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'),
  ADD COLUMN IF NOT EXISTS tts_model VARCHAR(80) CHECK (tts_model IS NULL OR tts_model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$');
