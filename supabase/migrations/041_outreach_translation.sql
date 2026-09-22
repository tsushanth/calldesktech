-- Non-English outreach drafts (see src/lib/outreach/language.ts) now also carry
-- an English back-translation, so an admin who can't read the target language
-- can still verify the content before approving it. NULL for English drafts.
ALTER TABLE calldesk_outreach_messages ADD COLUMN IF NOT EXISTS translation_subject TEXT;
ALTER TABLE calldesk_outreach_messages ADD COLUMN IF NOT EXISTS translation_body TEXT;
