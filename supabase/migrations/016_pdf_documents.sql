-- PDF upload support (see 'knowledge-base-files' Storage bucket, created
-- separately via the Storage API — private, PDF-only, 25MB limit).
-- storage_path is nullable and only set for type='pdf', pointing at the
-- uploaded file's path in that bucket so the original PDF stays available
-- (re-processing, download, audit) rather than only keeping its extracted
-- text.

ALTER TABLE calldesk_knowledge_documents
  DROP CONSTRAINT IF EXISTS calldesk_knowledge_documents_type_check;

ALTER TABLE calldesk_knowledge_documents
  ADD CONSTRAINT calldesk_knowledge_documents_type_check CHECK (type IN ('website', 'text', 'pdf'));

ALTER TABLE calldesk_knowledge_documents
  ADD COLUMN IF NOT EXISTS storage_path TEXT;
