-- Retell's own Add-Knowledge-Base flow lets one knowledge base hold several
-- independently-added documents (web pages, uploaded files, pasted text) —
-- ours was locked to a single source_type/source_url per KB. This adds a
-- documents table so a KB can accumulate multiple sources over time, and
-- tracks which document each knowledge_item came from so removing one
-- document can remove just its own items rather than the whole KB.
--
-- calldesk_knowledge_bases.source_type/source_url are left in place (still
-- used by the very first document created alongside the KB, and by
-- existing rows) rather than migrated/dropped — this is additive, not a
-- breaking schema change to data already in production.

CREATE TABLE IF NOT EXISTS calldesk_knowledge_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  knowledge_base_id UUID REFERENCES calldesk_knowledge_bases(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('website', 'text')),
  source_url TEXT,
  title TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'ready' CHECK (status IN ('processing', 'ready', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE calldesk_knowledge_items
  ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES calldesk_knowledge_documents(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_calldesk_knowledge_documents_kb_id ON calldesk_knowledge_documents(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_calldesk_knowledge_items_document_id ON calldesk_knowledge_items(document_id);

ALTER TABLE calldesk_knowledge_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own knowledge documents" ON calldesk_knowledge_documents
  FOR ALL USING (
    knowledge_base_id IN (
      SELECT kb.id FROM calldesk_knowledge_bases kb
      JOIN calldesk_tenants t ON kb.tenant_id = t.id
      WHERE t.user_id = auth.uid()::text
    )
  );
