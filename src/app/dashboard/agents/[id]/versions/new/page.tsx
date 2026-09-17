'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { RetellVoice } from '@/lib/retell';
import type { FlowNode, FlowEdge, StructuredCondition, TtsBackend } from '@/types';
import { AGENT_TEMPLATES } from '@/lib/agentTemplates';
import FlowVisualEditor from './FlowVisualEditor';

type DraftNode = FlowNode & { _key: string };

let keySeq = 0;
function newKey() {
  keySeq += 1;
  return `n${keySeq}`;
}

function draftNodesFromTemplate(nodes: FlowNode[]): DraftNode[] {
  return nodes.map((n) => ({ ...n, _key: newKey() }));
}

const NODE_TYPES: FlowNode['type'][] = ['greeting', 'extraction', 'function', 'knowledge_base', 'transfer', 'goodbye', 'payment', 'logic_split', 'press_digit', 'sms', 'code', 'mcp', 'subagent'];

const CONDITION_OPERATORS: StructuredCondition['operator'][] = ['==', '!=', '>', '<', '>=', '<='];

function emptyNode(): DraftNode {
  return { _key: newKey(), id: '', type: 'greeting', prompt: '', edges: [] };
}

export default function NewAgentVersionPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const agentId = params.id as string;
  // ?channel=text (from the Agents list page's "Text Agent" create option) —
  // a text/chat session never touches TTS/STT/Retell voice config at all
  // (see chatFlowResolver.ts's own comment: the flow graph is engine-
  // agnostic, chat just pins to the tenant's newest version regardless of
  // voice_engine), so those fields are real dead weight in this wizard for
  // a text-only agent, not just visual clutter to hide arbitrarily.
  const channel = searchParams.get('channel') === 'text' ? 'text' : 'voice';

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
  // Flow-level, not per-node (see call-loop-poc's _connectDeepgram comment
  // for why): Deepgram's speech-end confidence bar connects once, before
  // any node is known, so this can only honestly apply to the whole call.
  const [transcriptionMode, setTranscriptionMode] = useState<'' | 'fast' | 'balanced' | 'accurate'>('');
  const [startNodeId, setStartNodeId] = useState('');
  const [voiceEngine, setVoiceEngine] = useState<'retell' | 'poc'>('poc');
  const [voiceId, setVoiceId] = useState('');
  const [ttsBackend, setTtsBackend] = useState<'' | TtsBackend>('');
  const [retellAgentId, setRetellAgentId] = useState('');
  const [retellLlmId, setRetellLlmId] = useState('');
  const [nodes, setNodes] = useState<DraftNode[]>([emptyNode()]);
  const [nodeView, setNodeView] = useState<'list' | 'visual'>('list');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Template picker gate — matches Retell's own Create Agent modal, which
  // shows a template gallery before the editor rather than dropping you
  // straight into a blank flow. "Build from scratch" (or Single prompt)
  // skips straight past this; picking a template pre-fills the SAME editor
  // below with that template's real nodes for review/editing before save.
  const [showEditor, setShowEditor] = useState(false);
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null);
  const [templateCategory, setTemplateCategory] = useState('All');
  // "Generate from prompt" (matches Retell's own Create Agent modal) — a
  // real LLM call that drafts a starting flow from a plain-English
  // description, not a canned/fake response. Lands in the SAME editor as a
  // template pick, for review/editing before save — never auto-saved.
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const applyTemplate = (templateId: string) => {
    const template = AGENT_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    setAgentType('conversational_flow');
    setNodes(draftNodesFromTemplate(template.nodes));
    setStartNodeId(template.startNodeId);
    setAppliedTemplateId(template.id);
    setFlowName(template.id);
    setShowEditor(true);
  };

  const startFromScratch = (type: 'single_prompt' | 'conversational_flow') => {
    setAgentType(type);
    setAppliedTemplateId(null);
    setShowEditor(true);
  };

  const handleGenerateFromPrompt = async () => {
    if (!generatePrompt.trim()) return;
    setIsGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch('/api/agents/generate-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: generatePrompt.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to generate a flow');
      setAgentType('conversational_flow');
      setNodes(draftNodesFromTemplate(body.nodes));
      setStartNodeId(body.startNodeId);
      setAppliedTemplateId(null);
      setFlowName('generated');
      setShowGenerateModal(false);
      setShowEditor(true);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Failed to generate a flow');
    } finally {
      setIsGenerating(false);
    }
  };

  const templateCategories = ['All', ...Array.from(new Set(AGENT_TEMPLATES.map((t) => t.category)))];
  const visibleTemplates = templateCategory === 'All' ? AGENT_TEMPLATES : AGENT_TEMPLATES.filter((t) => t.category === templateCategory);
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
          ? {
              ...n,
              edges: [
                ...n.edges,
                {
                  id: `e${n.edges.length + 1}_${nodeKey}`,
                  ...(n.type === 'logic_split'
                    ? { condition: { field: '', operator: '==' as const, value: '' } }
                    : n.type === 'press_digit'
                      ? {}
                      : { condition: '' }),
                  target: '',
                },
              ],
            }
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
        // A logic_split edge left with a blank field is an intentional
        // default/fallback (see the "blank = default" placeholder in the
        // editor above) — strip its condition entirely so server.js's
        // _evaluateLogicSplit actually treats it as unconditional, rather
        // than saving it as an object with an empty field that would just
        // never match anything.
        if (n.type === 'logic_split') {
          return {
            ...n,
            edges: n.edges.map((e) =>
              typeof e.condition === 'object' && !e.condition.field.trim()
                ? { id: e.id, target: e.target }
                : e
            ),
          };
        }
        return n;
      });
      if (cleanNodes.some((n) => !n.id.trim())) return setError('Every node needs an id.');
      const ids = new Set(cleanNodes.map((n) => n.id));
      if (ids.size !== cleanNodes.length) return setError('Node ids must be unique.');
      if (!startNodeId || !ids.has(startNodeId)) return setError('Pick a valid start node.');
      for (const n of cleanNodes) {
        if (n.type === 'press_digit' && n.edges.length !== 1) {
          return setError(`Node "${n.id}" (press digit) needs exactly one edge — it always advances to the same place once the tones finish.`);
        }
        if (n.type === 'subagent') {
          let subagentTools: unknown;
          try {
            subagentTools = n.params?.tools ? JSON.parse(n.params.tools) : [];
          } catch {
            return setError(`Node "${n.id}" (subagent) has invalid JSON in its tools list.`);
          }
          if (!Array.isArray(subagentTools)) {
            return setError(`Node "${n.id}" (subagent) — tools must be a JSON array.`);
          }
          const toolIds = new Set<string>();
          for (const t of subagentTools as Array<{ id?: unknown; kind?: unknown }>) {
            if (!t || typeof t.id !== 'string' || !t.id.trim()) {
              return setError(`Node "${n.id}" (subagent) has a tool with no id.`);
            }
            if (toolIds.has(t.id)) return setError(`Node "${n.id}" (subagent) has two tools with the id "${t.id}".`);
            toolIds.add(t.id);
            if (typeof t.kind !== 'string' || !['function', 'code', 'sms', 'mcp', 'transfer'].includes(t.kind)) {
              return setError(`Node "${n.id}" (subagent) tool "${t.id}" has an invalid kind — must be function, code, sms, mcp, or transfer.`);
            }
          }
        }
        for (const e of n.edges) {
          if (!e.target || !ids.has(e.target)) return setError(`Node "${n.id}" has an edge with no valid target.`);
          if (n.type === 'logic_split') {
            // A conditionless edge on a logic_split is an intentional default
            // (see server.js's _evaluateLogicSplit), so only validate when a
            // structured condition is actually present.
            if (e.condition && typeof e.condition === 'object' && !e.condition.field.trim()) {
              return setError(`Node "${n.id}" has a logic split edge with an operator but no field.`);
            }
          } else if (n.type === 'press_digit') {
            // press_digit ignores condition entirely — server.js's
            // _executePressDigit always takes edges[0].target.
          } else if (!e.condition || typeof e.condition !== 'string' || !e.condition.trim()) {
            return setError(`Node "${n.id}" has an edge with no condition.`);
          }
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
          globalSettings: transcriptionMode ? { transcriptionMode } : undefined,
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
        <div className="mt-1.5 flex items-center gap-2">
          <h1 className="text-[22px] font-semibold text-[#1a1d29]">New version</h1>
          {channel === 'text' && (
            <span className="rounded-full bg-purple-50 px-2.5 py-0.5 text-[11.5px] font-medium text-purple-600">Text agent</span>
          )}
        </div>
        <p className="text-gray-500 text-[13px] mt-1">
          {channel === 'text'
            ? 'Versions are immutable — this creates a new one, it never edits an existing version. A text agent answers your chat widget; the newest version is always what it runs.'
            : 'Versions are immutable — this creates a new one, it never edits an existing version. Route a phone number to it afterward to make it live.'}
        </p>
      </div>

      {error && <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-700">{error}</div>}

      {!showEditor ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-3">
            <button
              type="button"
              onClick={() => startFromScratch('conversational_flow')}
              className="rounded-xl border border-dashed border-gray-300 bg-white px-5 py-5 text-left transition hover:border-gray-400"
            >
              <p className="text-[13.5px] font-medium text-[#1a1d29]">Build from scratch</p>
              <p className="mt-0.5 text-[12px] text-gray-500">Start with a blank flow</p>
            </button>
            <button
              type="button"
              onClick={() => startFromScratch('single_prompt')}
              className="rounded-xl border border-dashed border-gray-300 bg-white px-5 py-5 text-left transition hover:border-gray-400"
            >
              <p className="text-[13.5px] font-medium text-[#1a1d29]">Single prompt</p>
              <p className="mt-0.5 text-[12px] text-gray-500">One prompt, no flow steps</p>
            </button>
            <button
              type="button"
              onClick={() => { setGenerateError(null); setShowGenerateModal(true); }}
              className="rounded-xl border border-dashed border-blue-300 bg-blue-50/40 px-5 py-5 text-left transition hover:border-blue-400 hover:bg-blue-50"
            >
              <p className="text-[13.5px] font-medium text-[#1a1d29]">Generate from prompt</p>
              <p className="mt-0.5 text-[12px] text-gray-500">Describe it, AI drafts a flow</p>
            </button>
          </div>

          <div className="mt-5 mb-2 flex items-center justify-between">
            <p className="text-[12.5px] font-medium text-gray-500">Templates</p>
            <div className="flex flex-wrap gap-1">
              {templateCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setTemplateCategory(cat)}
                  className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${
                    cat === templateCategory ? 'bg-[#1a1d29] text-white' : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleTemplates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t.id)}
                className="rounded-xl border border-gray-200 bg-white px-5 py-5 text-left transition hover:border-blue-300 hover:bg-blue-50/30"
              >
                <p className="text-[11px] font-medium uppercase tracking-wide text-blue-600">{t.category}</p>
                <p className="mt-1 text-[13.5px] font-medium text-[#1a1d29]">{t.label}</p>
                <p className="mt-0.5 text-[12px] text-gray-500">{t.description}</p>
              </button>
            ))}
          </div>
        </>
      ) : (
      <>
      <div className="mb-4 flex items-center justify-between">
        <div>
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
        <button
          type="button"
          onClick={() => { setShowEditor(false); setNodes([emptyNode()]); setStartNodeId(''); setSinglePrompt(''); }}
          className="text-[12.5px] font-medium text-gray-500 hover:text-[#1a1d29]"
        >
          ← Choose a different starting point
        </button>
      </div>
      {appliedTemplateId && (
        <p className="mb-4 text-[12.5px] text-gray-500">
          Starting from the <span className="font-medium text-[#1a1d29]">{AGENT_TEMPLATES.find((t) => t.id === appliedTemplateId)?.label}</span> template — everything below is fully editable.
        </p>
      )}

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
          {channel === 'voice' && agentType === 'conversational_flow' && voiceEngine === 'poc' && (
          <div>
            <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Transcription mode</label>
            <select
              value={transcriptionMode}
              onChange={(e) => setTranscriptionMode(e.target.value as typeof transcriptionMode)}
              className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              <option value="">Balanced (default)</option>
              <option value="fast">Fast — quicker turn-taking, more false starts</option>
              <option value="accurate">Accurate — waits longer, fewer false starts</option>
            </select>
            <p className="mt-1 text-[11px] text-gray-400">Applies to the whole call, not one step — the speech-recognition connection opens before any step is known.</p>
          </div>
          )}
          {channel === 'voice' && (
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
          )}
          {channel === 'voice' && (voiceEngine === 'poc' ? (
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
          ))}
          {channel === 'voice' && (
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
          )}
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
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
            <button
              onClick={() => setNodeView('list')}
              className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition ${nodeView === 'list' ? 'bg-[#1a1d29] text-white' : 'text-gray-500 hover:text-gray-700'}`}
            >
              List
            </button>
            <button
              onClick={() => setNodeView('visual')}
              className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition ${nodeView === 'visual' ? 'bg-[#1a1d29] text-white' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Visual
            </button>
          </div>
          <button
            onClick={addNode}
            className="text-[13px] border border-gray-200 text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg transition"
          >
            + Add node
          </button>
        </div>
      </div>

      {nodeView === 'visual' && (
        <div className="mb-8">
          <FlowVisualEditor
            nodes={nodes}
            startNodeId={startNodeId}
            onPositionChange={(nodeKey, position) => updateNode(nodeKey, { position })}
          />
          <p className="mt-2 text-[11.5px] text-gray-400">
            Drag nodes to arrange them — positions are saved with the version. Switch to List to edit a node&apos;s fields.
          </p>
        </div>
      )}

      <div className={`space-y-4 mb-8 ${nodeView === 'visual' ? 'hidden' : ''}`}>
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

            {node.type === 'logic_split' ? (
              <p className="mb-4 text-[12px] text-gray-400">
                Logic split has no instructions and never talks to the caller — it evaluates the edges below directly against previously collected data and jumps immediately, with no LLM call.
              </p>
            ) : node.type === 'press_digit' ? (
              <p className="mb-4 text-[12px] text-gray-400">
                Press digit has no instructions and never talks — it plays real DTMF tones into the call (for navigating another system's phone tree on an outbound call) via a brief detour, then continues to its one edge below.
              </p>
            ) : (
              <div className="mb-4">
                <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Instructions</label>
                <textarea
                  value={node.prompt || ''}
                  onChange={(e) => updateNode(node._key, { prompt: e.target.value })}
                  rows={2}
                  placeholder="What should the assistant do at this step?"
                  className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
                />
              </div>
            )}

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

            {node.type === 'payment' && (
              <div className="mb-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Amount (0 = tokenize only, no charge)</label>
                  <input
                    value={node.params?.amount || '0'}
                    onChange={(e) => updateNode(node._key, { params: { ...node.params, amount: e.target.value } })}
                    placeholder="0"
                    className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div>
                  <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Pay Connector name</label>
                  <input
                    value={node.params?.paymentConnector || 'Default'}
                    onChange={(e) => updateNode(node._key, { params: { ...node.params, paymentConnector: e.target.value } })}
                    placeholder="Default"
                    className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <p className="col-span-2 text-[11.5px] text-gray-400">
                  Hands the call to Twilio&apos;s own &lt;Pay&gt; — raw card details never reach our server. Requires a Pay Connector installed and PCI Mode enabled in the Twilio Console first.
                </p>
              </div>
            )}

            {node.type === 'press_digit' && (
              <div className="mb-4">
                <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Digits to press</label>
                <input
                  value={node.params?.digits || ''}
                  onChange={(e) => updateNode(node._key, { params: { ...node.params, digits: e.target.value } })}
                  placeholder='e.g. 2{{account_number}}# — 0-9, *, #, A-D, w/W for pauses'
                  className="w-full max-w-md bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                <p className="mt-1 text-[11.5px] text-gray-400">
                  {'{{field}}'} pulls in a previously collected value (e.g. an account number extracted earlier). Only for an outbound call this agent placed — pressing digits into another system's IVR, not reading the caller's own keypad input.
                </p>
              </div>
            )}

            {node.type === 'sms' && (
              <div className="mb-4 space-y-3">
                <div>
                  <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Send to</label>
                  <input
                    value={node.params?.to || ''}
                    onChange={(e) => updateNode(node._key, { params: { ...node.params, to: e.target.value } })}
                    placeholder="Leave blank to text the caller's own number"
                    className="w-full max-w-md bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div>
                  <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Message</label>
                  <textarea
                    value={node.params?.body || ''}
                    onChange={(e) => updateNode(node._key, { params: { ...node.params, body: e.target.value } })}
                    rows={2}
                    placeholder="e.g. Here's your confirmation link: {{confirmation_url}}"
                    className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
                  />
                </div>
                <p className="text-[11.5px] text-gray-400">
                  Sent from the tenant's own number (the one the caller dialed), the moment this step is entered — {'{{field}}'} pulls in a previously collected value.
                </p>
              </div>
            )}

            {node.type === 'code' && (
              <div className="mb-4">
                <label className="block text-[12.5px] font-medium text-gray-500 mb-1">JavaScript</label>
                <textarea
                  value={node.params?.code || ''}
                  onChange={(e) => updateNode(node._key, { params: { ...node.params, code: e.target.value } })}
                  rows={6}
                  placeholder={"return { total: dv.price * dv.quantity };"}
                  spellCheck={false}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 font-mono text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 resize-y"
                />
                <p className="mt-1 text-[11.5px] text-gray-400">
                  Runs in a real sandbox (QuickJS, not Node&apos;s own <code>vm</code> module or <code>eval</code>) the moment this step is entered — no secrets from this server are exposed to it. <code>dv</code> holds previously collected fields (all strings); call <code>fetch(url, options)</code> for a lightweight HTTP lookup (no <code>await</code> needed, requests to private/local addresses are blocked). Return a plain object to merge its fields into what&apos;s collected so far.
                </p>
              </div>
            )}

            {node.type === 'mcp' && (
              <div className="mb-4 space-y-3">
                <div>
                  <label className="block text-[12.5px] font-medium text-gray-500 mb-1">MCP server URL</label>
                  <input
                    value={node.params?.serverUrl || ''}
                    onChange={(e) => updateNode(node._key, { params: { ...node.params, serverUrl: e.target.value } })}
                    placeholder="https://your-mcp-server.example.com/mcp"
                    className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div>
                  <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Headers (JSON)</label>
                  <input
                    value={node.params?.headers || ''}
                    onChange={(e) => updateNode(node._key, { params: { ...node.params, headers: e.target.value } })}
                    placeholder='{"Authorization": "Bearer {{access_token}}"}'
                    className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Tool name</label>
                    <input
                      value={node.params?.toolName || ''}
                      onChange={(e) => updateNode(node._key, { params: { ...node.params, toolName: e.target.value } })}
                      placeholder="lookup_order"
                      className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Arguments (JSON)</label>
                    <input
                      value={node.params?.toolArguments || ''}
                      onChange={(e) => updateNode(node._key, { params: { ...node.params, toolArguments: e.target.value } })}
                      placeholder='{"order_id": "{{order_id}}"}'
                      className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                </div>
                <p className="text-[11.5px] text-gray-400">
                  Calls this one pre-selected tool on the remote MCP server the moment this step is entered — a real JSON-RPC round trip (initialize → tools/call), not simulated. {'{{field}}'} pulls in a previously collected value anywhere in headers or arguments. A JSON object result merges into collected data; anything else is handed to the model as plain text.
                </p>
              </div>
            )}

            {node.type === 'subagent' && (
              <div className="mb-4">
                <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Tools (JSON array)</label>
                <textarea
                  value={node.params?.tools || ''}
                  onChange={(e) => updateNode(node._key, { params: { ...node.params, tools: e.target.value } })}
                  rows={8}
                  spellCheck={false}
                  placeholder={`[\n  { "id": "lookup_order", "kind": "function", "description": "Look up an order by id", "webhookUrl": "https://...", "functionName": "lookup_order" },\n  { "id": "send_confirmation", "kind": "sms", "description": "Text the caller a confirmation code", "body": "Your code: {{code}}" }\n]`}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 font-mono text-[12px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 resize-y"
                />
                <p className="mt-1 text-[11.5px] text-gray-400">
                  Unlike every other node type, the model decides WHEN (if ever) to call each of these, mid-conversation, across as many turns as it takes — it doesn&apos;t auto-run on entry. Each entry needs a unique <code>id</code> and a <code>kind</code> (<code>function</code>, <code>code</code>, <code>sms</code>, <code>mcp</code>, or <code>transfer</code>) plus that kind&apos;s own fields — same fields as that kind&apos;s dedicated node type above (e.g. an <code>sms</code> tool takes <code>to</code>/<code>body</code>, an <code>mcp</code> tool takes <code>serverUrl</code>/<code>headers</code>/<code>toolName</code>/<code>toolArguments</code>). The tools are pre-configured here, not supplied by the model.
                </p>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[12.5px] font-medium text-gray-500">
                  {node.type === 'logic_split'
                    ? 'Edges (evaluated in code against collected data — first match wins)'
                    : node.type === 'press_digit'
                      ? 'Edge (always follows this one target once the tones finish — no condition)'
                      : 'Edges (evaluated by the model, not string-matched)'}
                </label>
                {!(node.type === 'press_digit' && node.edges.length >= 1) && (
                  <button onClick={() => addEdge(node._key)} className="text-[12px] font-medium text-blue-600 hover:text-blue-700">
                    + Add edge
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {node.edges.map((edge, i) => (
                  <div key={edge.id} className="flex gap-2 items-center">
                    {node.type === 'press_digit' ? null : node.type === 'logic_split' ? (
                      <>
                        <input
                          value={typeof edge.condition === 'object' ? edge.condition.field : ''}
                          onChange={(e) =>
                            updateEdge(node._key, i, {
                              condition: {
                                field: e.target.value,
                                operator: typeof edge.condition === 'object' ? edge.condition.operator : '==',
                                value: typeof edge.condition === 'object' ? edge.condition.value : '',
                              },
                            })
                          }
                          placeholder="field, e.g. payment_status"
                          className="w-40 bg-white border border-gray-200 rounded-lg px-3 py-1.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                        <select
                          value={typeof edge.condition === 'object' ? edge.condition.operator : '=='}
                          onChange={(e) =>
                            updateEdge(node._key, i, {
                              condition: {
                                field: typeof edge.condition === 'object' ? edge.condition.field : '',
                                operator: e.target.value as StructuredCondition['operator'],
                                value: typeof edge.condition === 'object' ? edge.condition.value : '',
                              },
                            })
                          }
                          className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        >
                          {CONDITION_OPERATORS.map((op) => (
                            <option key={op} value={op}>{op}</option>
                          ))}
                        </select>
                        <input
                          value={typeof edge.condition === 'object' ? edge.condition.value : ''}
                          onChange={(e) =>
                            updateEdge(node._key, i, {
                              condition: {
                                field: typeof edge.condition === 'object' ? edge.condition.field : '',
                                operator: typeof edge.condition === 'object' ? edge.condition.operator : '==',
                                value: e.target.value,
                              },
                            })
                          }
                          placeholder="value, e.g. succeeded (blank = default)"
                          className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </>
                    ) : (
                      <input
                        value={typeof edge.condition === 'string' ? edge.condition : ''}
                        onChange={(e) => updateEdge(node._key, i, { condition: e.target.value })}
                        placeholder="condition, e.g. caller wants to book an appointment"
                        className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    )}
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

            {node.type !== 'logic_split' && node.type !== 'press_digit' && (
              <details className="mt-4 pt-4 border-t border-gray-100 group">
                <summary className="cursor-pointer text-[12.5px] font-medium text-gray-500 hover:text-gray-700 select-none">
                  Advanced settings
                </summary>
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Interruption sensitivity</label>
                      <select
                        value={node.params?.interruptionSensitivity || 'high'}
                        onChange={(e) => updateNode(node._key, { params: { ...node.params, interruptionSensitivity: e.target.value } })}
                        className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      >
                        <option value="high">High (default — interrupt on any word)</option>
                        <option value="medium">Medium (needs ~2 words)</option>
                        <option value="low">Low (needs ~3 words)</option>
                      </select>
                      <p className="mt-1 text-[11px] text-gray-400">Real threshold on barge-in detection — filters out short interjections ("um", "okay") the caller didn't mean as an interruption.</p>
                    </div>
                    <div>
                      <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Response wait time (ms)</label>
                      <input
                        type="number"
                        min={0}
                        max={10000}
                        value={node.params?.responseWaitTimeMs || ''}
                        onChange={(e) => updateNode(node._key, { params: { ...node.params, responseWaitTimeMs: e.target.value } })}
                        placeholder="0 (respond immediately)"
                        className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                      <p className="mt-1 text-[11px] text-gray-400">Delay before replying, in case the caller pauses mid-thought and keeps talking. Max 10s.</p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Reminder message frequency (seconds)</label>
                    <input
                      type="number"
                      min={0}
                      value={node.params?.reminderMessageFrequencySec || ''}
                      onChange={(e) => updateNode(node._key, { params: { ...node.params, reminderMessageFrequencySec: e.target.value } })}
                      placeholder="0 (disabled)"
                      className="w-full max-w-[220px] bg-white border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                    <p className="mt-1 text-[11px] text-gray-400">If the caller goes silent this long, the agent checks in ("Are you still there?") — up to 3 times before giving up.</p>
                  </div>
                  <div>
                    <label className="block text-[12.5px] font-medium text-gray-500 mb-1">Fine-tuning examples</label>
                    <textarea
                      value={node.params?.fineTuningExamples || ''}
                      onChange={(e) => updateNode(node._key, { params: { ...node.params, fineTuningExamples: e.target.value } })}
                      rows={3}
                      placeholder="Example scenarios this step should handle a specific way, e.g.: if the caller gives a partial address, ask for the missing part before moving on."
                      className="w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 resize-y"
                    />
                    <p className="mt-1 text-[11px] text-gray-400">Free-text guidance folded into this step's instructions — not recited verbatim, just extra context for tricky cases.</p>
                  </div>
                </div>
              </details>
            )}

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
      )}

      {showGenerateModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={() => setShowGenerateModal(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold text-[#1a1d29]">Generate from prompt</h2>
              <button type="button" onClick={() => setShowGenerateModal(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <p className="mb-3 text-[13px] text-gray-500">
              Describe what this agent should do — a real model call drafts a starting flow, which opens in the
              editor below for you to review and edit before saving. Nothing is saved automatically.
            </p>
            <textarea
              value={generatePrompt}
              onChange={(e) => setGeneratePrompt(e.target.value)}
              rows={4}
              placeholder="e.g. A dental office receptionist that books cleanings, answers questions about insurance we accept, and takes a message if the caller needs something else."
              className="mb-3 w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
            />
            {generateError && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">{generateError}</div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowGenerateModal(false)}
                className="rounded-lg px-4 py-2 text-[13.5px] font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateFromPrompt}
                disabled={isGenerating || !generatePrompt.trim()}
                className="rounded-lg bg-[#1a1d29] px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-[#2a2e3d] disabled:opacity-40"
              >
                {isGenerating ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
