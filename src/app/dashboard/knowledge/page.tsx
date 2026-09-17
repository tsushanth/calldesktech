'use client';

import { useState, useEffect } from 'react';
import { useOnboarding } from '@/context/OnboardingContext';
import { api, type KnowledgeBase, type KnowledgeItem, type KnowledgeDocument } from '@/lib/api';

export default function KnowledgePage() {
  const { tenantId, isHydrated } = useOnboarding();
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKB, setSelectedKB] = useState<string | null>(null);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showAddWebPageModal, setShowAddWebPageModal] = useState(false);
  const [showAddTextModal, setShowAddTextModal] = useState(false);
  const [addDocError, setAddDocError] = useState<string | null>(null);

  useEffect(() => {
    async function loadKnowledgeBases() {
      if (!tenantId || !isHydrated) return;

      setIsLoading(true);
      try {
        const data = await api.getKnowledgeBases(tenantId);
        setKnowledgeBases(data);
        if (data.length > 0) {
          setSelectedKB(data[0].id);
        }
      } catch (err) {
        console.error('Failed to load knowledge bases:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadKnowledgeBases();
  }, [tenantId, isHydrated]);

  useEffect(() => {
    async function loadItems() {
      if (!selectedKB) {
        setItems([]);
        return;
      }

      try {
        const data = await api.getKnowledgeItems(selectedKB);
        setItems(data);
      } catch (err) {
        console.error('Failed to load knowledge items:', err);
      }
    }

    loadItems();
  }, [selectedKB]);

  useEffect(() => {
    async function loadDocuments() {
      if (!selectedKB) {
        setDocuments([]);
        return;
      }

      try {
        const data = await api.getKnowledgeDocuments(selectedKB);
        setDocuments(data);
      } catch (err) {
        console.error('Failed to load knowledge documents:', err);
      }
    }

    loadDocuments();
  }, [selectedKB]);

  const refreshCurrentKB = async () => {
    if (!selectedKB) return;
    const [docs, docItems] = await Promise.all([
      api.getKnowledgeDocuments(selectedKB),
      api.getKnowledgeItems(selectedKB),
    ]);
    setDocuments(docs);
    setItems(docItems);
  };

  const handleAddWebPage = async (sourceUrl: string, title: string) => {
    if (!selectedKB) return;
    setAddDocError(null);
    try {
      await api.addKnowledgeDocument(selectedKB, { type: 'website', sourceUrl, title: title || undefined });
      await refreshCurrentKB();
      setShowAddWebPageModal(false);
    } catch (err) {
      setAddDocError(err instanceof Error ? err.message : 'Failed to add web page');
    }
  };

  const handleAddText = async (text: string, title: string) => {
    if (!selectedKB) return;
    setAddDocError(null);
    try {
      await api.addKnowledgeDocument(selectedKB, { type: 'text', text, title: title || undefined });
      await refreshCurrentKB();
      setShowAddTextModal(false);
    } catch (err) {
      setAddDocError(err instanceof Error ? err.message : 'Failed to add text');
    }
  };

  const handleCreateKB = async (name: string, sourceType: 'manual' | 'website' | 'pdf', sourceUrl?: string) => {
    if (!tenantId) return;

    try {
      const newKB = await api.createKnowledgeBase({
        tenant_id: tenantId,
        name,
        source_type: sourceType,
        source_url: sourceUrl,
      });
      setKnowledgeBases([newKB, ...knowledgeBases]);
      setSelectedKB(newKB.id);
      setShowAddModal(false);
    } catch (err) {
      console.error('Failed to create knowledge base:', err);
    }
  };

  const handleDeleteKB = async (kbId: string, kbName: string) => {
    if (!window.confirm(`Delete "${kbName}"? This also deletes all its FAQs and can't be undone.`)) return;

    try {
      await api.deleteKnowledgeBase(kbId);
      const remaining = knowledgeBases.filter((kb) => kb.id !== kbId);
      setKnowledgeBases(remaining);
      if (selectedKB === kbId) {
        setSelectedKB(remaining.length > 0 ? remaining[0].id : null);
      }
    } catch (err) {
      console.error('Failed to delete knowledge base:', err);
      alert(err instanceof Error ? err.message : 'Failed to delete knowledge base');
    }
  };

  const handleAddItem = async (question: string, answer: string) => {
    if (!selectedKB) return;

    try {
      const newItems = await api.addKnowledgeItems([{
        knowledge_base_id: selectedKB,
        question,
        answer,
      }]);
      setItems([...newItems, ...items]);
      setShowAddItemModal(false);
    } catch (err) {
      console.error('Failed to add knowledge item:', err);
    }
  };

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[22px] font-semibold text-[#1a1d29]">Knowledge Base</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-[#1a1d29] px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-[#2a2e3d]"
        >
          + New Knowledge Base
        </button>
      </div>

      {isLoading ? (
        <div className="p-10 text-center text-[13.5px] text-gray-400">Loading…</div>
      ) : knowledgeBases.length === 0 ? (
        <EmptyState onAdd={() => setShowAddModal(true)} />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
          {/* Knowledge Base List */}
          <div className="col-span-1 space-y-1.5">
            {knowledgeBases.map((kb) => (
              <div
                key={kb.id}
                className={`group flex w-full items-center gap-2.5 rounded-lg p-3 text-left transition ${
                  selectedKB === kb.id ? 'bg-blue-50' : 'border border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <button onClick={() => setSelectedKB(kb.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                  <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-lg ${selectedKB === kb.id ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                    <BookIcon />
                  </span>
                  <div className="min-w-0">
                    <p className={`truncate text-[13.5px] font-medium ${selectedKB === kb.id ? 'text-blue-700' : 'text-[#1a1d29]'}`}>{kb.name}</p>
                    <p className="text-[11.5px] capitalize text-gray-400">{kb.source_type}</p>
                  </div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteKB(kb.id, kb.name);
                  }}
                  aria-label={`Delete ${kb.name}`}
                  className="flex-none rounded-md p-1.5 text-gray-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>

          {/* Knowledge Items */}
          <div className="col-span-1 lg:col-span-3">
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                <h2 className="text-[14px] font-semibold text-[#1a1d29]">
                  {knowledgeBases.find((kb) => kb.id === selectedKB)?.name || 'Select a knowledge base'}
                </h2>
                {selectedKB && (
                  <div className="relative">
                    <button
                      onClick={() => setShowAddMenu((v) => !v)}
                      className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] font-medium text-[#1a1d29] hover:bg-gray-50"
                    >
                      + Add
                    </button>
                    {showAddMenu && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowAddMenu(false)} />
                        <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                          <button
                            onClick={() => { setShowAddMenu(false); setAddDocError(null); setShowAddWebPageModal(true); }}
                            className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] text-[#1a1d29] hover:bg-gray-50"
                          >
                            Add web page
                          </button>
                          <button
                            onClick={() => { setShowAddMenu(false); setAddDocError(null); setShowAddTextModal(true); }}
                            className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] text-[#1a1d29] hover:bg-gray-50"
                          >
                            Add text
                          </button>
                          <button
                            onClick={() => { setShowAddMenu(false); setShowAddItemModal(true); }}
                            className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] text-[#1a1d29] hover:bg-gray-50"
                          >
                            Add FAQ
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {documents.length > 0 && (
                <div className="border-b border-gray-100 px-5 py-3.5">
                  <p className="mb-2 text-[11.5px] font-medium uppercase tracking-wide text-gray-400">Documents</p>
                  <div className="space-y-1.5">
                    {documents.map((doc) => (
                      <div key={doc.id} className="flex items-center gap-2.5 rounded-lg bg-gray-50 px-3 py-2">
                        <span className="flex-none text-gray-400">{doc.type === 'website' ? <LinkIcon /> : <TextIcon />}</span>
                        <p className="min-w-0 flex-1 truncate text-[13px] text-[#1a1d29]">{doc.title || doc.source_url || 'Untitled document'}</p>
                        <StatusBadge status={doc.status} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {items.length === 0 ? (
                <div className="p-10 text-center text-[13.5px] text-gray-400">
                  <p className="mb-3">No items in this knowledge base yet.</p>
                  <button onClick={() => setShowAddItemModal(true)} className="font-medium text-blue-600 hover:text-blue-700">
                    Add your first FAQ
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {items.map((item) => (
                    <div key={item.id} className="px-5 py-4">
                      <p className="mb-1.5 text-[13.5px] font-medium text-[#1a1d29]">Q: {item.question}</p>
                      <p className="text-[13.5px] text-gray-500">A: {item.answer}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Knowledge Base Modal */}
      {showAddModal && (
        <AddKnowledgeBaseModal
          onClose={() => setShowAddModal(false)}
          onSubmit={handleCreateKB}
        />
      )}

      {/* Add Item Modal */}
      {showAddItemModal && (
        <AddItemModal
          onClose={() => setShowAddItemModal(false)}
          onSubmit={handleAddItem}
        />
      )}

      {showAddWebPageModal && (
        <AddWebPageModal
          onClose={() => { setShowAddWebPageModal(false); setAddDocError(null); }}
          onSubmit={handleAddWebPage}
          error={addDocError}
        />
      )}

      {showAddTextModal && (
        <AddTextModal
          onClose={() => { setShowAddTextModal(false); setAddDocError(null); }}
          onSubmit={handleAddText}
          error={addDocError}
        />
      )}
    </>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-white p-14 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-500">
        <BookIcon large />
      </div>
      <h2 className="text-[16px] font-semibold text-[#1a1d29]">No Knowledge Base Yet</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[13.5px] text-gray-500">
        Help your AI receptionist answer questions accurately by adding FAQs, service information, and common customer questions.
      </p>
      <button onClick={onAdd} className="mt-5 rounded-lg bg-[#1a1d29] px-5 py-2.5 text-[13.5px] font-medium text-white transition hover:bg-[#2a2e3d]">
        Create Knowledge Base
      </button>
    </div>
  );
}

function AddKnowledgeBaseModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (name: string, sourceType: 'manual' | 'website' | 'pdf', sourceUrl?: string) => void;
}) {
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState<'manual' | 'website' | 'pdf'>('manual');
  const [sourceUrl, setSourceUrl] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(name, sourceType, sourceType === 'website' ? sourceUrl : undefined);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-[17px] font-semibold text-[#1a1d29]">Create Knowledge Base</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., FAQs, Services, Pricing"
              className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Source Type</label>
            <div className="grid grid-cols-3 gap-2">
              {(['manual', 'website', 'pdf'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setSourceType(type)}
                  className={`rounded-lg border p-2.5 text-[12.5px] capitalize transition ${
                    sourceType === type ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {sourceType === 'website' && (
            <div>
              <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Website URL</label>
              <input
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
          )}

          <div className="flex gap-2.5 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-[13.5px] font-medium text-gray-600 transition hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-[13.5px] font-medium text-white transition hover:bg-blue-700">
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddItemModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (question: string, answer: string) => void;
}) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(question, answer);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-[17px] font-semibold text-[#1a1d29]">Add FAQ</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Question</label>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What are your hours of operation?"
              className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Answer</label>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="We're open Monday through Friday, 9 AM to 5 PM."
              rows={4}
              className="w-full resize-none rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              required
            />
          </div>

          <div className="flex gap-2.5 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-[13.5px] font-medium text-gray-600 transition hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-[13.5px] font-medium text-white transition hover:bg-blue-700">
              Add FAQ
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddWebPageModal({
  onClose,
  onSubmit,
  error,
}: {
  onClose: () => void;
  onSubmit: (sourceUrl: string, title: string) => void;
  error: string | null;
}) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    await onSubmit(sourceUrl, title);
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-[17px] font-semibold text-[#1a1d29]">Add web page</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-[12.5px] font-medium text-gray-500">URL</label>
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://example.com/hours"
              className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Title (optional)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Hours & Location"
              className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {error && <p className="text-[13px] text-red-600">{error}</p>}

          <div className="flex gap-2.5 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-[13.5px] font-medium text-gray-600 transition hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-[13.5px] font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
            >
              {submitting ? 'Fetching…' : 'Add web page'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddTextModal({
  onClose,
  onSubmit,
  error,
}: {
  onClose: () => void;
  onSubmit: (text: string, title: string) => void;
  error: string | null;
}) {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    await onSubmit(text, title);
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-[17px] font-semibold text-[#1a1d29]">Add text</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Title (optional)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Return Policy"
              className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Text</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste any content you want the AI to be able to answer questions from."
              rows={8}
              className="w-full resize-none rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              required
            />
          </div>

          {error && <p className="text-[13px] text-red-600">{error}</p>}

          <div className="flex gap-2.5 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-[13.5px] font-medium text-gray-600 transition hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-[13.5px] font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
            >
              {submitting ? 'Adding…' : 'Add text'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: 'processing' | 'ready' | 'failed' }) {
  const styles = {
    processing: 'bg-amber-50 text-amber-600',
    ready: 'bg-green-50 text-green-600',
    failed: 'bg-red-50 text-red-600',
  };
  const labels = { processing: 'Processing', ready: 'Ready', failed: 'Failed' };
  return <span className={`flex-none rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[status]}`}>{labels[status]}</span>;
}

function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

function BookIcon({ large }: { large?: boolean }) {
  const size = large ? 22 : 15;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H12v16h6.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
