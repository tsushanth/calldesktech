'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import type { Subflow, FlowNode, FlowEdge } from '@/types';

let keySeq = 0;
function newKey() {
  keySeq += 1;
  return `sfn${keySeq}`;
}

type DraftNode = FlowNode & { _key: string };

const NODE_TYPES: { type: FlowNode['type']; label: string }[] = [
  { type: 'greeting', label: 'Conversation' },
  { type: 'extraction', label: 'Extraction' },
  { type: 'function', label: 'Function' },
  { type: 'transfer', label: 'Call Transfer' },
  { type: 'logic_split', label: 'Logic Split' },
  { type: 'knowledge_base', label: 'Knowledge Base' },
  { type: 'goodbye', label: 'Ending' },
];

// A standalone editor for one subflow's node graph, linked to from a
// subflow_ref node in the main flow builder. Deliberately a simpler form
// than the main builder's NodeSettingsPanel — id/type/prompt/edges only,
// no per-node-type param editors (code/mcp/sms/etc.) — a subflow is meant
// to hold a small reusable sub-routine (e.g. an IVR-navigation detour), not
// every node type the main canvas supports. Can be extended later if a
// subflow genuinely needs one of those types.
export default function SubflowEditorPage() {
  const params = useParams();
  const subflowId = params.subflowId as string;

  const [subflow, setSubflow] = useState<Subflow | null>(null);
  const [name, setName] = useState('');
  const [nodes, setNodes] = useState<DraftNode[]>([]);
  const [startNodeId, setStartNodeId] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/subflows/${subflowId}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      const sf = body.subflow as Subflow;
      setSubflow(sf);
      setName(sf.name);
      setNodes((sf.nodes || []).map((n) => ({ ...n, _key: newKey() })));
      setStartNodeId(sf.startNodeId || sf.nodes?.[0]?.id || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subflow');
    } finally {
      setIsLoading(false);
    }
  }, [subflowId]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedNode = nodes.find((n) => n._key === selectedKey) || null;

  const updateNode = (key: string, patch: Partial<DraftNode>) => {
    setNodes((prev) => prev.map((n) => (n._key === key ? { ...n, ...patch } : n)));
  };
  const addNode = () => {
    const node: DraftNode = { _key: newKey(), id: '', type: 'greeting', prompt: '', edges: [] };
    setNodes((prev) => [...prev, node]);
    setSelectedKey(node._key);
  };
  const removeNode = (key: string) => {
    setNodes((prev) => prev.filter((n) => n._key !== key));
    setSelectedKey((prev) => (prev === key ? null : prev));
  };
  const addEdge = (key: string) => {
    setNodes((prev) =>
      prev.map((n) => (n._key === key ? { ...n, edges: [...n.edges, { id: `e${Date.now()}`, condition: '', target: '' } as FlowEdge] } : n))
    );
  };
  const updateEdge = (key: string, i: number, patch: Partial<FlowEdge>) => {
    setNodes((prev) =>
      prev.map((n) => (n._key === key ? { ...n, edges: n.edges.map((e, idx) => (idx === i ? { ...e, ...patch } : e)) } : n))
    );
  };
  const removeEdge = (key: string, i: number) => {
    setNodes((prev) => prev.map((n) => (n._key === key ? { ...n, edges: n.edges.filter((_, idx) => idx !== i) } : n)));
  };

  const handleSave = async () => {
    if (!name.trim()) return setError('Name is required');
    const nodeIds = new Set(nodes.map((n) => n.id));
    if (nodes.some((n) => !n.id.trim())) return setError('Every node needs a non-empty id');
    if (nodeIds.size !== nodes.length) return setError('Node ids must be unique within this subflow');
    if (!startNodeId || !nodeIds.has(startNodeId)) return setError('Start node must be one of this subflow\'s own nodes');
    for (const n of nodes) {
      for (const e of n.edges) {
        if (!nodeIds.has(e.target)) return setError(`Node "${n.id}" has an edge targeting unknown node "${e.target}"`);
      }
    }
    setError('');
    setIsSaving(true);
    try {
      const cleanNodes: FlowNode[] = nodes.map(({ _key, ...n }) => n);
      const res = await fetch(`/api/subflows/${subflowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), nodes: cleanNodes, startNodeId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setSubflow(body.subflow);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save subflow');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <div className="p-8 text-[13.5px] text-gray-500">Loading…</div>;
  if (!subflow) return <div className="p-8 text-[13.5px] text-red-600">{error || 'Subflow not found'}</div>;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <input value={name} onChange={(e) => setName(e.target.value)} className="text-[20px] font-semibold text-[#1a1d29] focus:outline-none" />
          <p className="text-[12.5px] text-gray-500">{subflow.scope === 'library' ? 'Library subflow — reusable across agents' : 'Agent subflow'}</p>
        </div>
        <div className="flex items-center gap-3">
          {savedAt && <span className="text-[12px] text-green-600">Saved</span>}
          <button onClick={handleSave} disabled={isSaving} className="rounded-lg bg-[#1a1d29] px-4 py-2 text-[13.5px] font-medium text-white hover:bg-[#2a2e3d] disabled:opacity-40">
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">{error}</div>}

      <div className="mb-4">
        <label className="mb-1 block text-[12px] font-medium text-gray-500">Start node</label>
        <select value={startNodeId} onChange={(e) => setStartNodeId(e.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px]">
          <option value="">Select…</option>
          {nodes.map((n) => (
            <option key={n._key} value={n.id}>{n.id || '(unnamed)'}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-[240px_1fr] gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-gray-500">Nodes</span>
            <button onClick={addNode} className="text-[12px] font-medium text-blue-600 hover:text-blue-700">+ Add</button>
          </div>
          <div className="space-y-1">
            {nodes.map((n) => (
              <button
                key={n._key}
                onClick={() => setSelectedKey(n._key)}
                className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[12.5px] ${selectedKey === n._key ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                {n.id || '(unnamed)'} {n.id === startNodeId && <span className="text-[10px] text-green-600">start</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          {selectedNode ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-gray-500">Node id</label>
                  <input value={selectedNode.id} onChange={(e) => updateNode(selectedNode._key, { id: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[12.5px]" />
                </div>
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-gray-500">Type</label>
                  <select value={selectedNode.type} onChange={(e) => updateNode(selectedNode._key, { type: e.target.value as FlowNode['type'] })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px]">
                    {NODE_TYPES.map((t) => (
                      <option key={t.type} value={t.type}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-gray-500">Prompt</label>
                <textarea value={selectedNode.prompt || ''} onChange={(e) => updateNode(selectedNode._key, { prompt: e.target.value })} rows={6} className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px]" />
              </div>
              <div className="border-t border-gray-100 pt-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-[12px] font-medium text-gray-500">Transitions</label>
                  <button onClick={() => addEdge(selectedNode._key)} className="text-[12px] font-medium text-blue-600 hover:text-blue-700">+ Add edge</button>
                </div>
                {selectedNode.edges.length === 0 && (
                  <p className="text-[12px] text-gray-400">No edges — a subflow node with zero edges is a terminal: reaching it during a call hands control back to the parent flow via the subflow_ref node&apos;s own edges.</p>
                )}
                <div className="space-y-2">
                  {selectedNode.edges.map((edge, i) => (
                    <div key={edge.id || i} className="flex items-center gap-2">
                      <input
                        value={typeof edge.condition === 'string' ? edge.condition : ''}
                        onChange={(e) => updateEdge(selectedNode._key, i, { condition: e.target.value })}
                        placeholder="Condition (natural language)"
                        className="flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px]"
                      />
                      <span className="text-gray-300">→</span>
                      <select value={edge.target} onChange={(e) => updateEdge(selectedNode._key, i, { target: e.target.value })} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px]">
                        <option value="">Select target…</option>
                        {nodes.map((n) => (
                          <option key={n._key} value={n.id}>{n.id || '(unnamed)'}</option>
                        ))}
                      </select>
                      <button onClick={() => removeEdge(selectedNode._key, i)} className="text-red-400 hover:text-red-600">✕</button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-gray-100 pt-3">
                <button onClick={() => removeNode(selectedNode._key)} className="text-[12.5px] font-medium text-red-500 hover:text-red-600">Remove node</button>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-gray-400">Select a node on the left to edit it, or add one.</p>
          )}
        </div>
      </div>
    </div>
  );
}
