'use client';

import { useState, useEffect } from 'react';
import { useOnboarding } from '@/context/OnboardingContext';
import { api, type KnowledgeBase, type KnowledgeItem } from '@/lib/api';

export default function KnowledgePage() {
  const { tenantId, isHydrated } = useOnboarding();
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKB, setSelectedKB] = useState<string | null>(null);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddItemModal, setShowAddItemModal] = useState(false);

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
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">Knowledge Base</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition flex items-center gap-2"
        >
          <span>+</span>
          <span>New Knowledge Base</span>
        </button>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-gray-400">Loading...</div>
      ) : knowledgeBases.length === 0 ? (
        <EmptyState onAdd={() => setShowAddModal(true)} />
      ) : (
        <div className="grid grid-cols-4 gap-6">
          {/* Knowledge Base List */}
          <div className="col-span-1 space-y-2">
            {knowledgeBases.map((kb) => (
              <button
                key={kb.id}
                onClick={() => setSelectedKB(kb.id)}
                className={`w-full text-left p-4 rounded-lg transition ${
                  selectedKB === kb.id
                    ? 'bg-blue-600'
                    : 'bg-gray-800 border border-gray-700 hover:bg-gray-700'
                }`}
              >
                <p className="font-medium">{kb.name}</p>
                <p className="text-sm text-gray-400 capitalize">{kb.source_type}</p>
              </button>
            ))}
          </div>

          {/* Knowledge Items */}
          <div className="col-span-3">
            <div className="bg-gray-800 rounded-xl border border-gray-700">
              <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                <h2 className="font-semibold">
                  {knowledgeBases.find(kb => kb.id === selectedKB)?.name || 'Select a knowledge base'}
                </h2>
                {selectedKB && (
                  <button
                    onClick={() => setShowAddItemModal(true)}
                    className="text-blue-400 hover:text-blue-300 text-sm"
                  >
                    + Add FAQ
                  </button>
                )}
              </div>

              {items.length === 0 ? (
                <div className="p-8 text-center text-gray-400">
                  <p className="mb-4">No items in this knowledge base yet.</p>
                  <button
                    onClick={() => setShowAddItemModal(true)}
                    className="text-blue-400 hover:text-blue-300"
                  >
                    Add your first FAQ
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-gray-700">
                  {items.map((item) => (
                    <div key={item.id} className="p-4">
                      <p className="font-medium text-blue-400 mb-2">Q: {item.question}</p>
                      <p className="text-gray-300">A: {item.answer}</p>
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
    </>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-12 text-center">
      <div className="text-5xl mb-4">🧠</div>
      <h2 className="text-xl font-semibold mb-2">No Knowledge Base Yet</h2>
      <p className="text-gray-400 mb-6 max-w-md mx-auto">
        Help your AI receptionist answer questions accurately by adding FAQs,
        service information, and common customer questions.
      </p>
      <button
        onClick={onAdd}
        className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg transition"
      >
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Create Knowledge Base</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., FAQs, Services, Pricing"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:border-blue-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Source Type</label>
            <div className="grid grid-cols-3 gap-2">
              {(['manual', 'website', 'pdf'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setSourceType(type)}
                  className={`p-3 rounded-lg border text-sm capitalize transition ${
                    sourceType === type
                      ? 'bg-blue-600 border-blue-500'
                      : 'bg-gray-700 border-gray-600 hover:border-gray-500'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {sourceType === 'website' && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Website URL</label>
              <input
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:border-blue-500 focus:outline-none"
              />
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition"
            >
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-full max-w-lg">
        <h2 className="text-xl font-bold mb-4">Add FAQ</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Question</label>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What are your hours of operation?"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:border-blue-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Answer</label>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="We're open Monday through Friday, 9 AM to 5 PM."
              rows={4}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:border-blue-500 focus:outline-none resize-none"
              required
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition"
            >
              Add FAQ
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
