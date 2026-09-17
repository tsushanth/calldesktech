'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { RetellVoice } from '@/lib/retell';
import type { FlowNode, FlowEdge, TtsBackend } from '@/types';

type DraftNode = FlowNode & { _key: string };

let keySeq = 0;
function newKey() {
  keySeq += 1;
  return `n${keySeq}`;
}

const NODE_TYPES: FlowNode['type'][] = ['greeting', 'extraction', 'function', 'knowledge_base', 'transfer', 'goodbye'];

function emptyNode(): DraftNode {
  return { _key: newKey(), id: '', type: 'greeting', prompt: '', edges: [] };
}

export default function NewAgentVersionPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.id as string;

  // "Single prompt" (matches Retell's own Create Agent modal, which offers
  // this alongside "Conversational flow") isn't a different runtime concept
  // — a single-node flow with no edges already works today (a terminal
  // node the model just keeps talking from). This mode is purely a UI
  // simplification: one big prompt textarea instead of the full node
  // graph, which gets wrapped into a one-node flow on save. No schema or
  // API changes needed — see handleSave below.
  const [agentType, setAgentType] = useState<'single_prompt' | 'conversational_flow'>('conversational_flow');
  const [singlePrompt, setSinglePrompt] = useState('');
  const [flowName, setFlowName] = useState('v1');
  const [startNodeId, setStartNodeId] = useState('');
  const [voiceEngine, setVoiceEngine] = useState<'retell' | 'poc'>('poc');
  const [voiceId, setVoiceId] = useState('');
  const [ttsBackend, setTtsBackend] = useState<'' | TtsBackend>('');
  const [retellAgentId, setRetellAgentId] = useState('');
  const [retellLlmId, setRetellLlmId] = useState('');
  const [nodes, setNodes] = useState<DraftNode[]>([emptyNode()]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Retell's real multi-provider voice catalog (elevenlabs, openai, cartesia,
  // minimax, fish_audio, platform) — replaces a plain text input that only
  // ever hinted at an ElevenLabs-shaped id ("e.g. ... 11labs-Adrian").
  const [retellVoices, setRetellVoices] = useState<RetellVoice[]>([]);

  useEffect(() => {
    if (voiceEngine !== 'retell' || retellVoices.length > 0) return;
    api.getRetellVoices().then(setRetellVoices).catch((err) => console.error('Failed to load Retell voices:', err));
  }, [voiceEngine, retellVoices.length]);

  const updateNode = (key: string, patch: Partial<DraftNode>) => {
    setNodes((prev) => prev.map((n) => (n._key === key ? { ...n, ...patch } : n)));
  };
  const removeNode = (key: string) => {
    setNodes((prev) => prev.filter((n) => n._key !== key));
  };
  const addNode = () => setNodes((prev) => [...prev, emptyNode()]);

  const updateEdge = (nodeKey: string, edgeIndex: number, patch: Partial<FlowEdge>) => {
    setNodes((prev) =>
      prev.map((n) =>
        n._key === nodeKey
          ? { ...n, edges: n.edges.map((e, i) => (i === edgeIndex ? { ...e, ...patch } : e)) }
          : n
      )
    );
  };
  const addEdge = (nodeKey: string) => {
    setNodes((prev) =>
      prev.map((n) =>
        n._key === nodeKey
          ? { ...n, edges: [...n.edges, { id: `e${n.edges.length + 1}_${nodeKey}`, condition: '', target: '' }] }
          : n
      )
    );
  };
  const removeEdge = (nodeKey: string, edgeIndex: number) => {
    setNodes((prev) =>
      prev.map((n) => (n._key === nodeKey ? { ...n, edges: n.edges.filter((_, i) => i !== edgeIndex) } : n))
    );
  };

  const updateExtractField = (nodeKey: string, oldKey: string, newKey: string, type: string) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n._key !== nodeKey) return n;
        const extract = { ...(n.extract || {}) };
        if (oldKey !== newKey) delete extract[oldKey];
        if (newKey) extract[newKey] = type;
        return { ...n, extract };
      })
    );
  };
  const addExtractField = (nodeKey: string) => updateExtractField(nodeKey, '', `field_${Date.now() % 1000}`, 'string');
  const removeExtractField = (nodeKey: string, key: string) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n._key !== nodeKey) return n;
        const extract = { ...(n.extract || {}) };
        delete extract[key];
        return { ...n, extract };
      })
    );
  };

  const handleSave = async () => {
    setError(null);

    let cleanNodes: FlowNode[];
    let effectiveStartNodeId: string;

    if (agentType === 'single_prompt') {
      if (!singlePrompt.trim()) return setError('Write the agent\'s prompt.');
      // One terminal node, no edges — the model just talks from this
      // single prompt for the whole call, same as a real single-node flow
      // would behave; nothing about this is a special runtime case.
      cleanNodes = [{ id: 'main', type: 'greeting', prompt: singlePrompt.trim(), edges: [] }];
      effectiveStartNodeId = 'main';
    } else {
      cleanNodes = nodes.map(({ _key, ...n }) => {
        void _key;
        return n;
      });
      if (cleanNodes.some((n) => !n.id.trim())) return setError('Every node needs an id.');
      const ids = new Set(cleanNodes.map((n) => n.id));
      if (ids.size !== cleanNodes.length) return setError('Node ids must be unique.');
      if (!startNodeId || !ids.has(startNodeId)) return setError('Pick a valid start node.');
      for (const n of cleanNodes) {
        for (const e of n.edges) {
          if (!e.target || !ids.has(e.target)) return setError(`Node "${n.id}" has an edge with no valid target.`);
          if (!e.condition.trim()) return setError(`Node "${n.id}" has an edge with no condition.`);
        }
      }
      effectiveStartNodeId = startNodeId;
    }

    if (!flowName.trim()) return setError('Give this version a name.');

    setIsSaving(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowName: flowName.trim(),
          startNodeId: effectiveStartNodeId,
          nodes: cleanNodes,
          voiceEngine,
          voiceId: voiceId || undefined,
          ttsBackend: ttsBackend || undefined,
          retellAgentId: retellAgentId || undefined,
          retellLlmId: retellLlmId || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      router.push(`/dashboard/agents/${agentId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save version');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="mb-8">
        <Link href={`/dashboard/agents/${agentId}`} className="text-[12.5px] text-gray-400 hover:text-[#1a1d29]">
          ← Back to agent
        </Link>
        <h1 className="text-[22px] font-semibold text-[#1a1d29] mt-1.5">New version</h1>
        <p className="text-gray-500 text-[13px] mt-1">
          Versions are immutable — this creates a new one, it never edits an existing version. Route a phone
          number to it afterward to make it live.
        </p>
      </div>

      {error && <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-700">{error}</div>}

      <div className="mb-6">
        <label className="block text-[12.5px] font-medium text-gray-500 mb-1.5">Type</label>
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <button
            type="button"
            onClick={() => setAgentType('single_prompt')}
            className={`rounded-lg border px-4 py-3 text-left transition ${
              agentType === 'single_prompt' ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <p className="text-[13.5px] font-medium text-[#1a1d29]">Single prompt</p>
            <p className="text-[12px] text-gray-500">One prompt, no flow steps</p>
          </button>
          <button
            type="button"
            onClick={() => setAgentType('conversational_flow')}
            className={`rounded-lg border px-4 py-3 text-left transition ${
              agentType === 'conversational_flow' ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <p className="text-[13.5px] font-medium text-[#1a1d29]">Conversational flow</p>
            <p className="text-[12px] text-gray-500">Multi-step node graph</p>
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6 space-y-4">
        <h2 className="text-[14px] font-semibold text-[#1a1d29]">Version settings</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Version name</label>
            <input
              value={flowName}
              onChange={(e) => setFlowName(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          {agentType === 'conversational_flow' && (
          <div>
            <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Start node</label>
            <select
              value={startNodeId}
              onChange={(e) => setStartNodeId(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              <option value="">Select a node…</option>
              {nodes.filter((n) => n.id).map((n) => (
                <option key={n._key} value={n.id}>{n.id}</option>
              ))}
            </select>
          </div>
          )}
          <div>
            <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Call engine</label>
            <select
              value={voiceEngine}
              onChange={(e) => setVoiceEngine(e.target.value as 'retell' | 'poc')}
              className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              <option value="poc">In-house (poc)</option>
              <option value="retell">Retell</option>
            </select>
          </div>
          {voiceEngine === 'poc' ? (
            <div>
              <label className="block text-[12.5px] font-medium text-gray-500 mb-1">TTS backend</label>
              <select
                value={ttsBackend}
                onChange={(e) => setTtsBackend(e.target.value as '' | TtsBackend)}
                className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">Default (kokoro)</option>
                <option value="kokoro">Kokoro</option>
                <option value="elevenlabs">ElevenLabs</option>
                <option value="cartesia">Cartesia (beta — needs its own key on call-loop-poc)</option>
                <option value="minimax">MiniMax (beta — needs its own key on call-loop-poc)</option>
              </select>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Retell agent ID</label>
                <input
                  value={retellAgentId}
                  onChange={(e) => setRetellAgentId(e.target.value)}
                  placeholder="agent_..."
                  className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Retell LLM ID</label>
                <input
                  value={retellLlmId}
                  onChange={(e) => setRetellLlmId(e.target.value)}
                  placeholder="llm_..."
                  className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 font-mono text-sm"
                />
              </div>
            </>
          )}
          <div>
            <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Voice</label>
            {voiceEngine === 'retell' ? (
              <select
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">
                  {retellVoices.length === 0 ? 'Loading voices…' : 'Select a voice…'}
                </option>
                {retellVoices.map((v) => (
                  <option key={v.voice_id} value={v.voice_id}>
                    {v.voice_name} — {v.provider === 'fish_audio' ? 'Fish Audio' : v.provider} · {v.gender}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                placeholder="e.g. af_heart"
                className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            )}
          </div>
        </div>
      </div>

      {agentType === 'single_prompt' ? (
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
        <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Prompt</label>
        <p className="text-[12px] text-gray-400 mb-2">
          Everything the agent knows and does for the whole call — no separate steps, no transitions.
        </p>
        <textarea
          value={singlePrompt}
          onChange={(e) => setSinglePrompt(e.target.value)}
          rows={10}
          placeholder="You are a friendly receptionist for Acme Dental. Greet the caller, answer questions about hours and services, and help them book an appointment by collecting their name and preferred time."
          className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
        />
      </div>
      ) : (
      <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[15px] font-semibold text-[#1a1d29]">Nodes</h2>
        <button
          onClick={addNode}
          className="text-[13px] border border-gray-200 text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg transition"
        >
          + Add node
        </button>
      </div>

      <div className="space-y-4 mb-8">
        {nodes.map((node) => (
          <div key={node._key} className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Node id</label>
                <input
                  value={node.id}
                  onChange={(e) => updateNode(node._key, { id: e.target.value })}
                  placeholder="e.g. greeting"
                  className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div>
                <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Type</label>
                <select
                  value={node.type}
                  onChange={(e) => updateNode(node._key, { type: e.target.value as FlowNode['type'] })}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  {NODE_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Instructions</label>
              <textarea
                value={node.prompt}
                onChange={(e) => updateNode(node._key, { prompt: e.target.value })}
                rows={2}
                placeholder="What should the assistant do at this step?"
                className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
              />
            </div>

            {node.type === 'extraction' && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[12.5px] font-medium text-gray-500">Fields to collect</label>
                  <button onClick={() => addExtractField(node._key)} className="text-[12px] font-medium text-blue-600 hover:text-blue-700">
                    + Add field
                  </button>
                </div>
                <div className="space-y-2">
                  {Object.entries(node.extract || {}).map(([key]) => (
                    <div key={key} className="flex gap-2">
                      <input
                        defaultValue={key}
                        onBlur={(e) => updateExtractField(node._key, key, e.target.value, node.extract![key])}
                        placeholder="field name"
                        className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-[13px] font-mono focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                      <button onClick={() => removeExtractField(node._key, key)} className="text-gray-400 hover:text-red-500 px-2">
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {node.type === 'function' && (
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Function name</label>
                  <input
                    value={node.function || ''}
                    onChange={(e) => updateNode(node._key, { function: e.target.value })}
                    placeholder="check_availability"
                    className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div>
                  <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Webhook URL</label>
                  <input
                    value={node.params?.webhookUrl || ''}
                    onChange={(e) => updateNode(node._key, { params: { ...node.params, webhookUrl: e.target.value } })}
                    placeholder="https://..."
                    className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </div>
            )}

            {node.type === 'transfer' && (
              <div className="mb-4">
                <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Transfer to</label>
                <input
                  value={node.params?.transferTo || ''}
                  onChange={(e) => updateNode(node._key, { params: { ...node.params, transferTo: e.target.value } })}
                  placeholder="+1..."
                  className="w-full max-w-xs bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[12.5px] font-medium text-gray-500">Edges (evaluated by the model, not string-matched)</label>
                <button onClick={() => addEdge(node._key)} className="text-[12px] font-medium text-blue-600 hover:text-blue-700">
                  + Add edge
                </button>
              </div>
              <div className="space-y-2">
                {node.edges.map((edge, i) => (
                  <div key={edge.id} className="flex gap-2 items-center">
                    <input
                      value={edge.condition}
                      onChange={(e) => updateEdge(node._key, i, { condition: e.target.value })}
                      placeholder="condition, e.g. caller wants to book an appointment"
                      className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                    <span className="text-gray-400 text-[13px]">→</span>
                    <select
                      value={edge.target}
                      onChange={(e) => updateEdge(node._key, i, { target: e.target.value })}
                      className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-[13px] font-mono focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                      <option value="">target…</option>
                      {nodes.filter((n) => n.id && n._key !== node._key).map((n) => (
                        <option key={n._key} value={n.id}>{n.id}</option>
                      ))}
                    </select>
                    <button onClick={() => removeEdge(node._key, i)} className="text-gray-400 hover:text-red-500 px-2">
                      ✕
                    </button>
                  </div>
                ))}
                {node.edges.length === 0 && (
                  <p className="text-[12px] text-gray-400">No edges — this is a terminal node (like goodbye or transfer usually is).</p>
                )}
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end">
              <button onClick={() => removeNode(node._key)} className="text-[12.5px] font-medium text-red-500 hover:text-red-600">
                Remove node
              </button>
            </div>
          </div>
        ))}
      </div>
      </>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-6 py-2.5 rounded-lg text-[13.5px] font-medium text-white transition"
        >
          {isSaving ? 'Saving...' : 'Save version'}
        </button>
        <Link
          href={`/dashboard/agents/${agentId}`}
          className="border border-gray-200 hover:bg-gray-50 px-6 py-2.5 rounded-lg text-[13.5px] text-gray-600 transition"
        >
          Cancel
        </Link>
      </div>
    </>
  );
}
