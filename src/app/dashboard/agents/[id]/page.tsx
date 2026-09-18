'use client';

import { Fragment, useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { RetellVoice } from '@/lib/retell';
import type { Agent, AgentVersion, FlowNode, FlowEdge, StructuredCondition, TtsBackend, Subflow } from '@/types';
import { AGENT_TEMPLATES } from '@/lib/agentTemplates';
import { estimatePocCallCost } from '@/lib/costEstimate';
import { renderMiniMarkdown } from '@/lib/miniMarkdown';
import FlowVisualEditor from './versions/new/FlowVisualEditor';

type DraftNode = FlowNode & { _key: string };

let keySeq = 0;
function newKey() {
  keySeq += 1;
  return `n${keySeq}`;
}

function draftNodesFromTemplate(nodes: FlowNode[]): DraftNode[] {
  return nodes.map((n) => ({ ...n, _key: newKey() }));
}

const NODE_TYPES: { type: FlowNode['type']; label: string }[] = [
  { type: 'greeting', label: 'Conversation' },
  { type: 'extraction', label: 'Extraction' },
  { type: 'subagent', label: 'Subagent' },
  { type: 'function', label: 'Function' },
  { type: 'transfer', label: 'Call Transfer' },
  { type: 'press_digit', label: 'Press Digit' },
  { type: 'logic_split', label: 'Logic Split' },
  { type: 'sms', label: 'In-Call SMS' },
  { type: 'code', label: 'Code' },
  { type: 'mcp', label: 'MCP' },
  { type: 'knowledge_base', label: 'Knowledge Base' },
  { type: 'payment', label: 'Payment' },
  { type: 'goodbye', label: 'Ending' },
  { type: 'subflow_ref', label: 'Subflow' },
];

const CONDITION_OPERATORS: StructuredCondition['operator'][] = ['==', '!=', '>', '<', '>=', '<='];

function emptyNodeOfType(type: FlowNode['type']): DraftNode {
  return { _key: newKey(), id: '', type, prompt: '', edges: [] };
}

type Tab = 'agent' | 'simulation' | 'workflow';

export default function AgentBuilderPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const agentId = params.id as string;
  const channel = searchParams.get('channel') === 'text' ? 'text' : 'voice';

  const [activeTab, setActiveTab] = useState<Tab>('agent');

  // ---- Agent record (name, mode) ----
  const [agent, setAgent] = useState<Agent | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [showGraduateConfirm, setShowGraduateConfirm] = useState(false);
  const [isGraduating, setIsGraduating] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [subflows, setSubflows] = useState<Subflow[]>([]);

  const loadAgent = useCallback(async () => {
    try {
      const [agentRes, versionsRes] = await Promise.all([
        fetch(`/api/agents/${agentId}`),
        fetch(`/api/agents/${agentId}/versions`),
      ]);
      const agentBody = await agentRes.json();
      if (agentRes.ok) setAgent(agentBody.agent);
      const versionsBody = await versionsRes.json();
      if (versionsRes.ok) setVersions(versionsBody.versions || []);
      // Subflows are tenant-scoped (library) + agent-scoped, so this needs
      // the tenant id off the agent row we just fetched, not agentId alone.
      if (agentRes.ok && agentBody.agent?.tenant_id) {
        const sfRes = await fetch(`/api/tenants/${agentBody.agent.tenant_id}/subflows?agentId=${agentId}`);
        const sfBody = await sfRes.json();
        if (sfRes.ok) setSubflows(sfBody.subflows || []);
      }
    } catch {
      // Non-fatal — the builder below still works off its own version fetch.
    }
  }, [agentId]);

  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  const handleGraduate = async () => {
    setIsGraduating(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/graduate`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setAgent(body.agent);
      setShowGraduateConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to graduate agent');
    } finally {
      setIsGraduating(false);
    }
  };

  const handleSaveName = async () => {
    if (!agent || !nameDraft.trim() || nameDraft.trim() === agent.name) {
      setIsEditingName(false);
      return;
    }
    setIsSavingName(true);
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameDraft.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setAgent(body.agent);
      setIsEditingName(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename agent');
    } finally {
      setIsSavingName(false);
    }
  };

  // ---- Flow/version builder state (ported from the old versions/new wizard) ----
  const [agentType, setAgentType] = useState<'single_prompt' | 'conversational_flow'>('conversational_flow');
  const [singlePrompt, setSinglePrompt] = useState('');
  const [flowName, setFlowName] = useState('v1');
  const [transcriptionMode, setTranscriptionMode] = useState<'' | 'fast' | 'balanced' | 'accurate'>('');
  // Agent Handbook + Transition Flexibility (2026-09-18, builder parity
  // Phase 2) — both live in the flow's existing global_settings JSON, same
  // as transcriptionMode/timezone/allowInterruptions, so no schema change.
  // Threaded into call-loop-poc's _buildNodeSystemPrompt/_buildTransitionTool
  // (separate commit there) so they actually affect real calls, not just
  // sit in the UI.
  const [handbook, setHandbook] = useState('');
  const [transitionFlexibility, setTransitionFlexibility] = useState<'' | 'strict' | 'flexible'>('');
  const [startNodeId, setStartNodeId] = useState('');
  const [voiceEngine, setVoiceEngine] = useState<'retell' | 'poc'>('poc');
  const [voiceId, setVoiceId] = useState('');
  const [ttsBackend, setTtsBackend] = useState<'' | TtsBackend>('');
  const [retellAgentId, setRetellAgentId] = useState('');
  const [retellLlmId, setRetellLlmId] = useState('');
  const [nodes, setNodes] = useState<DraftNode[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<'global' | 'node'>('global');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null);
  const [templateCategory, setTemplateCategory] = useState('All');
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [isCheckingExisting, setIsCheckingExisting] = useState(true);
  const [basedOnVersionNumber, setBasedOnVersionNumber] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/agents/${agentId}/versions`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        const vs: AgentVersion[] = body.versions || [];
        const latest = vs[0];
        if (!latest?.flow_id) return;

        const flowRes = await fetch(`/api/flows/${latest.flow_id}`);
        const flowBody = await flowRes.json();
        if (!flowRes.ok || cancelled) return;
        const loadedNodes = (flowBody.flow?.nodes || []) as FlowNode[];
        if (loadedNodes.length === 0) return;

        setNodes(draftNodesFromTemplate(loadedNodes));
        setStartNodeId(flowBody.flow?.global_settings?.startNodeId || loadedNodes[0].id);
        setVoiceEngine(latest.voice_engine);
        setVoiceId(latest.voice_id || '');
        setTtsBackend((latest.tts_backend as TtsBackend) || '');
        setRetellAgentId(latest.retell_agent_id || '');
        setRetellLlmId(latest.retell_llm_id || '');
        const savedMode = flowBody.flow?.global_settings?.transcriptionMode;
        if (savedMode === 'fast' || savedMode === 'balanced' || savedMode === 'accurate') setTranscriptionMode(savedMode);
        setHandbook(flowBody.flow?.global_settings?.handbook || '');
        const savedFlexibility = flowBody.flow?.global_settings?.transitionFlexibility;
        if (savedFlexibility === 'strict' || savedFlexibility === 'flexible') setTransitionFlexibility(savedFlexibility);
        setAgentType('conversational_flow');
        setBasedOnVersionNumber(latest.version_number);
        setFlowName(`v${latest.version_number + 1}`);
        setAppliedTemplateId(null);
        setShowEditor(true);
      } catch {
        // Falls through to the template picker.
      } finally {
        if (!cancelled) setIsCheckingExisting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agentId]);

  // A template's subflow_ref nodes carry an inline seed (params._templateSubflowSeed)
  // instead of a real subflowId, since the subflow doesn't exist as a tenant
  // row until now. Creates a real agent-scoped subflow per seed and rewrites
  // the node to reference it, so from here on it behaves exactly like a
  // subflow the user built by hand (editable via "Edit" on the node, same
  // API, same publish-time embedding).
  const materializeTemplateSubflows = async (templateNodes: FlowNode[]): Promise<FlowNode[]> => {
    if (!agent) return templateNodes;
    return Promise.all(
      templateNodes.map(async (node) => {
        const seedJson = node.params?._templateSubflowSeed;
        if (node.type !== 'subflow_ref' || !seedJson) return node;
        try {
          const seed = JSON.parse(seedJson) as { name: string; nodes: FlowNode[]; startNodeId: string };
          const res = await fetch(`/api/tenants/${agent.tenant_id}/subflows`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId, scope: 'agent', name: seed.name, nodes: seed.nodes, startNodeId: seed.startNodeId }),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error);
          setSubflows((prev) => [body.subflow, ...prev]);
          return { ...node, params: { subflowId: body.subflow.id } };
        } catch (err) {
          console.error('Failed to materialize template subflow', err);
          return node; // falls back to an unconfigured subflow_ref node — still editable by hand
        }
      })
    );
  };

  const applyTemplate = async (templateId: string) => {
    const template = AGENT_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    setAgentType('conversational_flow');
    const materializedNodes = await materializeTemplateSubflows(template.nodes);
    setNodes(draftNodesFromTemplate(materializedNodes));
    setStartNodeId(template.startNodeId);
    setAppliedTemplateId(template.id);
    setFlowName(template.id);
    if (template.singlePrompt) setSinglePrompt(template.singlePrompt);
    setShowEditor(true);
  };

  const startFromScratch = (type: 'single_prompt' | 'conversational_flow') => {
    setAgentType(type);
    setAppliedTemplateId(null);
    if (type === 'conversational_flow' && nodes.length === 0) {
      setNodes([emptyNodeOfType('greeting')]);
    }
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
    setSelectedKey((prev) => (prev === key ? null : prev));
  };
  const addNodeOfType = (type: FlowNode['type']) => {
    const node = emptyNodeOfType(type);
    setNodes((prev) => [...prev, node]);
    setSelectedKey(node._key);
    setRightTab('node');
  };

  // Creates a real (empty, single-node) subflow row so a subflow_ref node
  // has something to point at right away — the user then fills it in via
  // "Edit" (which opens /dashboard/agents/[id]/subflows/[subflowId]).
  // scope='agent' by default; promoting to a library subflow is a PATCH from
  // that same page, not something this quick-create flow needs to expose.
  const handleCreateSubflow = async (name: string): Promise<Subflow | null> => {
    if (!agent) return null;
    const startId = `n${Date.now()}`;
    try {
      const res = await fetch(`/api/tenants/${agent.tenant_id}/subflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          scope: 'agent',
          name: name || 'New subflow',
          nodes: [{ id: startId, type: 'greeting', prompt: '', edges: [] }],
          startNodeId: startId,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setSubflows((prev) => [body.subflow, ...prev]);
      return body.subflow as Subflow;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create subflow');
      return null;
    }
  };

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
      if (!singlePrompt.trim()) return setError("Write the agent's prompt.");
      cleanNodes = [{ id: 'main', type: 'greeting', prompt: singlePrompt.trim(), edges: [] }];
      effectiveStartNodeId = 'main';
    } else {
      cleanNodes = nodes.map(({ _key, ...n }) => {
        void _key;
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
      if (!startNodeId || !ids.has(startNodeId)) return setError('Pick a valid start node (Global Settings tab).');
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
            if (e.condition && typeof e.condition === 'object' && !e.condition.field.trim()) {
              return setError(`Node "${n.id}" has a logic split edge with an operator but no field.`);
            }
          } else if (n.type === 'press_digit') {
            // no condition
          } else if (!e.condition || typeof e.condition !== 'string' || !e.condition.trim()) {
            return setError(`Node "${n.id}" has an edge with no condition.`);
          }
        }
      }
      effectiveStartNodeId = startNodeId;
    }

    if (!flowName.trim()) return setError('Give this version a name (Global Settings tab).');

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
          globalSettings: {
            ...(transcriptionMode ? { transcriptionMode } : {}),
            ...(handbook.trim() ? { handbook: handbook.trim() } : {}),
            ...(transitionFlexibility ? { transitionFlexibility } : {}),
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setBasedOnVersionNumber(body.version.version_number);
      setFlowName(`v${body.version.version_number + 1}`);
      loadAgent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save version');
    } finally {
      setIsSaving(false);
    }
  };

  const selectedNode = nodes.find((n) => n._key === selectedKey) || null;
  const isAdvanced = agent?.mode === 'advanced';

  if (isCheckingExisting) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-64 animate-pulse rounded-lg bg-gray-200" />
        <div className="h-[600px] animate-pulse rounded-xl bg-gray-100" />
      </div>
    );
  }

  return (
    <div className="-m-6 flex h-[calc(100vh-1px)] overflow-hidden">
      {/* Left icon rail */}
      <div className="flex w-16 flex-none flex-col items-center gap-1 border-r border-gray-100 bg-white py-4">
        <Link href="/dashboard/agents" className="mb-3 text-gray-300 hover:text-gray-500" title="All agents">
          <BackIcon />
        </Link>
        <RailButton active={activeTab === 'agent'} onClick={() => setActiveTab('agent')} icon={<AgentRailIcon />} label="Agent" />
        <RailButton active={activeTab === 'workflow'} onClick={() => setActiveTab('workflow')} icon={<WorkflowIcon />} label="Workflow" />
        <RailButton active={activeTab === 'simulation'} onClick={() => setActiveTab('simulation')} icon={<SimulationIcon />} label="Simulation" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <div className="flex flex-none items-center justify-between border-b border-gray-100 bg-white px-5 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName();
                    if (e.key === 'Escape') setIsEditingName(false);
                  }}
                  disabled={isSavingName}
                  className="rounded-lg border border-gray-200 px-2.5 py-1 text-[16px] font-semibold text-[#1a1d29] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                <button onClick={handleSaveName} disabled={isSavingName} className="text-[12.5px] font-medium text-blue-600 hover:text-blue-700">Save</button>
                <button onClick={() => setIsEditingName(false)} className="text-[12.5px] text-gray-400 hover:text-gray-600">Cancel</button>
              </div>
            ) : (
              <h1
                className="group flex cursor-pointer items-center gap-1.5 truncate text-[16px] font-semibold text-[#1a1d29]"
                onClick={() => { setNameDraft(agent?.name || ''); setIsEditingName(true); }}
                title="Click to rename"
              >
                {agent?.name || 'Agent'}
                <EditPencilIcon className="h-3.5 w-3.5 flex-none text-gray-300 opacity-0 transition group-hover:opacity-100" />
              </h1>
            )}
            {channel === 'text' && (
              <span className="flex-none rounded-full bg-purple-50 px-2.5 py-0.5 text-[11px] font-medium text-purple-600">Text</span>
            )}
            <span className={`flex-none rounded-full px-2.5 py-0.5 text-[11px] font-medium ${isAdvanced ? 'bg-purple-50 text-purple-600' : 'bg-gray-100 text-gray-600'}`}>
              {isAdvanced ? 'Advanced' : 'Simple (wizard-owned)'}
            </span>
            <div className="relative">
              <button
                onClick={() => setShowVersionHistory((v) => !v)}
                className="flex-none rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-gray-200"
              >
                {basedOnVersionNumber ? `V${basedOnVersionNumber}` : 'Unpublished'}
              </button>
              {showVersionHistory && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowVersionHistory(false)} />
                  <div className="absolute left-0 top-full z-50 mt-1.5 max-h-72 w-64 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1.5 shadow-lg">
                    <p className="px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">Version history</p>
                    {versions.length === 0 ? (
                      <p className="px-3.5 py-2 text-[12.5px] text-gray-400">No versions published yet.</p>
                    ) : (
                      versions.map((v) => (
                        <div key={v.id} className="flex items-center justify-between px-3.5 py-2 text-[12.5px] hover:bg-gray-50">
                          <span className="font-mono text-[#1a1d29]">V{v.version_number}</span>
                          <span className="text-gray-400">{new Date(v.created_at).toLocaleDateString()}</span>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          {activeTab === 'agent' && showEditor && (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-none rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? 'Publishing…' : 'Publish'}
            </button>
          )}
        </div>

        {!isAdvanced && showGraduateConfirm && (
          <div className="flex-none border-b border-amber-200 bg-amber-50 px-5 py-3">
            <p className="text-[13px] font-medium text-amber-800">This permanently switches off the wizard for this agent.</p>
            <p className="mt-0.5 text-[12.5px] text-amber-700/90">Once graduated, edits only happen through versions here — the guided wizard will no longer write to this agent.</p>
            <div className="mt-2 flex gap-2.5">
              <button onClick={handleGraduate} disabled={isGraduating} className="rounded-lg bg-amber-500 px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-amber-600 disabled:opacity-50">
                {isGraduating ? 'Switching…' : 'Yes, switch to advanced'}
              </button>
              <button onClick={() => setShowGraduateConfirm(false)} className="rounded-lg border border-amber-200 px-3.5 py-1.5 text-[12.5px] text-amber-700 hover:bg-amber-100">Cancel</button>
            </div>
          </div>
        )}

        {error && (
          <div className="flex-none border-b border-red-100 bg-red-50 px-5 py-2.5 text-[13px] text-red-700">{error}</div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === 'workflow' && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-[14px] font-medium text-[#1a1d29]">Multi-agent workflows</p>
                <p className="mt-1 text-[13px] text-gray-400">Coming soon — for now, build each agent individually on the Agent tab.</p>
              </div>
            </div>
          )}

          {activeTab === 'simulation' && <SimulationTab agentId={agentId} />}

          {activeTab === 'agent' && !showEditor && (
            <div className="h-full overflow-y-auto p-6">
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <button type="button" onClick={() => startFromScratch('conversational_flow')} className="rounded-xl border border-dashed border-gray-300 bg-white px-5 py-5 text-left transition hover:border-gray-400">
                  <p className="text-[13.5px] font-medium text-[#1a1d29]">Build from scratch</p>
                  <p className="mt-0.5 text-[12px] text-gray-500">Start with a blank flow</p>
                </button>
                <button type="button" onClick={() => startFromScratch('single_prompt')} className="rounded-xl border border-dashed border-gray-300 bg-white px-5 py-5 text-left transition hover:border-gray-400">
                  <p className="text-[13.5px] font-medium text-[#1a1d29]">Single prompt</p>
                  <p className="mt-0.5 text-[12px] text-gray-500">One prompt, no flow steps</p>
                </button>
                <button type="button" onClick={() => { setGenerateError(null); setShowGenerateModal(true); }} className="rounded-xl border border-dashed border-blue-300 bg-blue-50/40 px-5 py-5 text-left transition hover:border-blue-400 hover:bg-blue-50">
                  <p className="text-[13.5px] font-medium text-[#1a1d29]">Generate from prompt</p>
                  <p className="mt-0.5 text-[12px] text-gray-500">Describe it, AI drafts a flow</p>
                </button>
              </div>

              <div className="mb-2 mt-5 flex items-center justify-between">
                <p className="text-[12.5px] font-medium text-gray-500">Templates</p>
                <div className="flex flex-wrap gap-1">
                  {templateCategories.map((cat) => (
                    <button key={cat} type="button" onClick={() => setTemplateCategory(cat)} className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${cat === templateCategory ? 'bg-[#1a1d29] text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visibleTemplates.map((t) => (
                  <button key={t.id} type="button" onClick={() => applyTemplate(t.id)} className="rounded-xl border border-gray-200 bg-white px-5 py-5 text-left transition hover:border-blue-300 hover:bg-blue-50/30">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-blue-600">{t.category}</p>
                      {t.singlePrompt && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">also has single-prompt version</span>}
                    </div>
                    <p className="mt-1 text-[13.5px] font-medium text-[#1a1d29]">{t.label}</p>
                    <p className="mt-0.5 text-[12px] text-gray-500">{t.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'agent' && showEditor && (
            <div className="flex h-full">
              {/* Left node palette */}
              <div className="flex w-60 flex-none flex-col overflow-y-auto border-r border-gray-100 bg-white p-3">
                <button
                  onClick={() => { setShowEditor(false); setNodes([]); setStartNodeId(''); setSinglePrompt(''); setAppliedTemplateId(null); setBasedOnVersionNumber(null); }}
                  className="mb-3 text-left text-[12px] font-medium text-gray-400 hover:text-gray-600"
                >
                  ← Choose a different starting point
                </button>
                <div className="mb-2 flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                  <button
                    onClick={() => setAgentType('single_prompt')}
                    className={`flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium transition ${agentType === 'single_prompt' ? 'bg-white text-[#1a1d29] shadow-sm' : 'text-gray-500'}`}
                  >
                    Single prompt
                  </button>
                  <button
                    onClick={() => setAgentType('conversational_flow')}
                    className={`flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium transition ${agentType === 'conversational_flow' ? 'bg-white text-[#1a1d29] shadow-sm' : 'text-gray-500'}`}
                  >
                    Flow
                  </button>
                </div>
                {agentType === 'conversational_flow' && (
                  <>
                    <p className="mb-1.5 mt-2 px-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">Nodes — click to add</p>
                    <div className="space-y-1">
                      {NODE_TYPES.map((nt) => (
                        <button
                          key={nt.type}
                          onClick={() => addNodeOfType(nt.type)}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-[#1a1d29] transition hover:bg-gray-50"
                        >
                          <NodeTypeIcon type={nt.type} />
                          {nt.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <div className="mt-auto space-y-2 border-t border-gray-100 pt-3">
                  <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">Agent details</p>
                  {voiceEngine === 'poc' ? (
                    <>
                      <div className="flex items-center justify-between px-1 text-[12.5px]">
                        <span className="text-gray-500">Cost</span>
                        <span className="font-medium text-[#1a1d29]">${estimatePocCallCost(ttsBackend || 'kokoro').costPerMin.toFixed(3)}/min</span>
                      </div>
                      <div className="flex items-center justify-between px-1 text-[12.5px]">
                        <span className="text-gray-500">Latency</span>
                        <span className="font-medium text-[#1a1d29]">
                          {estimatePocCallCost(ttsBackend || 'kokoro').latencyRangeMs[0]}-{estimatePocCallCost(ttsBackend || 'kokoro').latencyRangeMs[1]}ms
                        </span>
                      </div>
                      <p className="px-1 text-[10.5px] text-gray-400">Estimated from a typical minute of conversation, not this call&apos;s actual usage.</p>
                    </>
                  ) : (
                    <p className="px-1 text-[11.5px] text-gray-400">Retell-engine cost/latency is governed by Retell&apos;s own usage-based pricing — see their dashboard, not estimated here.</p>
                  )}
                </div>
              </div>

              {/* Canvas / single-prompt textarea */}
              <div className="min-w-0 flex-1 overflow-hidden bg-gray-50 p-4">
                {agentType === 'single_prompt' ? (
                  <div className="h-full rounded-xl border border-gray-200 bg-white p-6">
                    <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Prompt</label>
                    <p className="mb-2 text-[12px] text-gray-400">Everything the agent knows and does for the whole call — no separate steps, no transitions.</p>
                    <textarea
                      value={singlePrompt}
                      onChange={(e) => setSinglePrompt(e.target.value)}
                      rows={16}
                      placeholder="You are a friendly receptionist for Acme Dental. Greet the caller, answer questions about hours and services, and help them book an appointment by collecting their name and preferred time."
                      className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                ) : (
                  <FlowVisualEditor
                    nodes={nodes}
                    startNodeId={startNodeId}
                    onPositionChange={(nodeKey, position) => updateNode(nodeKey, { position })}
                    selectedKey={selectedKey}
                    onSelectNode={(key) => { setSelectedKey(key); setRightTab('node'); }}
                    height="100%"
                  />
                )}
              </div>

              {/* Right settings panel */}
              <div className="flex w-[400px] flex-none flex-col overflow-y-auto border-l border-gray-100 bg-white">
                <div className="flex flex-none border-b border-gray-100">
                  <button
                    onClick={() => setRightTab('global')}
                    className={`flex-1 px-4 py-3 text-[13px] font-medium transition ${rightTab === 'global' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Global Settings
                  </button>
                  <button
                    onClick={() => setRightTab('node')}
                    className={`flex-1 px-4 py-3 text-[13px] font-medium transition ${rightTab === 'node' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Node Settings
                  </button>
                </div>

                <div className="flex-1 p-4">
                  {rightTab === 'global' ? (
                    <div className="space-y-4">
                      <div>
                        <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Version name</label>
                        <input
                          value={flowName}
                          onChange={(e) => setFlowName(e.target.value)}
                          className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </div>
                      {agentType === 'conversational_flow' && (
                        <div>
                          <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Start node</label>
                          <select
                            value={startNodeId}
                            onChange={(e) => setStartNodeId(e.target.value)}
                            className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          >
                            <option value="">Select a node…</option>
                            {nodes.filter((n) => n.id).map((n) => (
                              <option key={n._key} value={n.id}>{n.id}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {channel === 'voice' && (
                        <div>
                          <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Call engine</label>
                          <select
                            value={voiceEngine}
                            onChange={(e) => setVoiceEngine(e.target.value as 'retell' | 'poc')}
                            className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          >
                            <option value="poc">CallDeskTech</option>
                            <option value="retell">Retell</option>
                          </select>
                        </div>
                      )}
                      {channel === 'voice' && agentType === 'conversational_flow' && voiceEngine === 'poc' && (
                        <div>
                          <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Transcription mode</label>
                          <select
                            value={transcriptionMode}
                            onChange={(e) => setTranscriptionMode(e.target.value as typeof transcriptionMode)}
                            className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          >
                            <option value="">Balanced (default)</option>
                            <option value="fast">Fast — quicker turn-taking, more false starts</option>
                            <option value="accurate">Accurate — waits longer, fewer false starts</option>
                          </select>
                        </div>
                      )}
                      {voiceEngine === 'poc' && (
                        <div>
                          <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Transition flexibility</label>
                          <select
                            value={transitionFlexibility}
                            onChange={(e) => setTransitionFlexibility(e.target.value as typeof transitionFlexibility)}
                            className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          >
                            <option value="">Flexible (default) — use judgment on close matches</option>
                            <option value="strict">Strict — only transition when a condition is clearly, unambiguously met</option>
                          </select>
                        </div>
                      )}
                      {voiceEngine === 'poc' && (
                        <div>
                          <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Agent Handbook</label>
                          <textarea
                            value={handbook}
                            onChange={(e) => setHandbook(e.target.value)}
                            rows={6}
                            placeholder="Reference material the agent can draw on at every step — policies, pricing, FAQs — separate from this node's own instructions. Applies to the whole flow, not just one node."
                            className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                        </div>
                      )}
                      {channel === 'voice' && (voiceEngine === 'poc' ? (
                        <div>
                          <label className="mb-1 block text-[12.5px] font-medium text-gray-500">TTS backend</label>
                          <select
                            value={ttsBackend}
                            onChange={(e) => setTtsBackend(e.target.value as '' | TtsBackend)}
                            className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          >
                            <option value="">Default (CallDeskTech)</option>
                            <option value="kokoro">CallDeskTech</option>
                            <option value="elevenlabs">ElevenLabs</option>
                            <option value="cartesia">Cartesia (not yet enabled)</option>
                            <option value="minimax">MiniMax (not yet enabled)</option>
                          </select>
                        </div>
                      ) : (
                        <>
                          <div>
                            <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Retell agent ID</label>
                            <input value={retellAgentId} onChange={(e) => setRetellAgentId(e.target.value)} placeholder="agent_..." className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                          </div>
                          <div>
                            <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Retell LLM ID</label>
                            <input value={retellLlmId} onChange={(e) => setRetellLlmId(e.target.value)} placeholder="llm_..." className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                          </div>
                        </>
                      ))}
                      {channel === 'voice' && (
                        <div>
                          <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Voice</label>
                          {voiceEngine === 'retell' ? (
                            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100">
                              <option value="">{retellVoices.length === 0 ? 'Loading voices…' : 'Select a voice…'}</option>
                              {retellVoices.map((v) => (
                                <option key={v.voice_id} value={v.voice_id}>{v.voice_name} — {v.provider === 'fish_audio' ? 'Fish Audio' : v.provider} · {v.gender}</option>
                              ))}
                            </select>
                          ) : (
                            <input value={voiceId} onChange={(e) => setVoiceId(e.target.value)} placeholder="e.g. af_heart" className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                          )}
                        </div>
                      )}
                    </div>
                  ) : selectedNode ? (
                    <NodeSettingsPanel
                      key={selectedNode._key}
                      node={selectedNode}
                      allNodes={nodes}
                      onUpdate={(patch) => updateNode(selectedNode._key, patch)}
                      onRemove={() => removeNode(selectedNode._key)}
                      onAddEdge={() => addEdge(selectedNode._key)}
                      onUpdateEdge={(i, patch) => updateEdge(selectedNode._key, i, patch)}
                      onRemoveEdge={(i) => removeEdge(selectedNode._key, i)}
                      onAddExtractField={() => addExtractField(selectedNode._key)}
                      onUpdateExtractField={(oldKey, newKey, type) => updateExtractField(selectedNode._key, oldKey, newKey, type)}
                      onRemoveExtractField={(key) => removeExtractField(selectedNode._key, key)}
                      subflows={subflows}
                      onCreateSubflow={handleCreateSubflow}
                    />
                  ) : (
                    <p className="text-[13px] text-gray-400">Select a node on the canvas to edit it, or add one from the left panel.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showGenerateModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={() => setShowGenerateModal(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold text-[#1a1d29]">Generate from prompt</h2>
              <button type="button" onClick={() => setShowGenerateModal(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </div>
            <p className="mb-3 text-[13px] text-gray-500">Describe what this agent should do — a real model call drafts a starting flow, which opens in the editor for you to review and edit before saving.</p>
            <textarea
              value={generatePrompt}
              onChange={(e) => setGeneratePrompt(e.target.value)}
              rows={4}
              placeholder="e.g. A dental office receptionist that books cleanings, answers questions about insurance we accept, and takes a message if the caller needs something else."
              className="mb-3 w-full resize-none rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            {generateError && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">{generateError}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowGenerateModal(false)} className="rounded-lg px-4 py-2 text-[13.5px] font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleGenerateFromPrompt} disabled={isGenerating || !generatePrompt.trim()} className="rounded-lg bg-[#1a1d29] px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-[#2a2e3d] disabled:opacity-40">
                {isGenerating ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RailButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-14 flex-col items-center gap-1 rounded-lg py-2 text-[10.5px] font-medium transition ${
        active ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function NodeSettingsPanel({
  node,
  allNodes,
  onUpdate,
  onRemove,
  onAddEdge,
  onUpdateEdge,
  onRemoveEdge,
  onAddExtractField,
  onUpdateExtractField,
  onRemoveExtractField,
  subflows,
  onCreateSubflow,
}: {
  node: DraftNode;
  allNodes: DraftNode[];
  onUpdate: (patch: Partial<DraftNode>) => void;
  onRemove: () => void;
  onAddEdge: () => void;
  onUpdateEdge: (i: number, patch: Partial<FlowEdge>) => void;
  onRemoveEdge: (i: number) => void;
  onAddExtractField: () => void;
  onUpdateExtractField: (oldKey: string, newKey: string, type: string) => void;
  onRemoveExtractField: (key: string) => void;
  subflows?: Subflow[];
  onCreateSubflow?: (name: string) => Promise<Subflow | null>;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-gray-500">Node id</label>
          <input value={node.id} onChange={(e) => onUpdate({ id: e.target.value })} placeholder="e.g. greeting" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-gray-500">Type</label>
          <select value={node.type} onChange={(e) => onUpdate({ type: e.target.value as FlowNode['type'] })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100">
            {NODE_TYPES.map((t) => (
              <option key={t.type} value={t.type}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      {node.type === 'logic_split' ? (
        <p className="text-[12px] text-gray-400">Logic split has no instructions and never talks to the caller — it evaluates the edges below directly against previously collected data.</p>
      ) : node.type === 'press_digit' ? (
        <p className="text-[12px] text-gray-400">Press digit has no instructions — it plays real DTMF tones, then continues to its one edge below.</p>
      ) : (
        <div>
          <label className="mb-1 block text-[12px] font-medium text-gray-500">Instructions</label>
          <textarea value={node.prompt || ''} onChange={(e) => onUpdate({ prompt: e.target.value })} rows={4} placeholder="What should the assistant do at this step?" className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        </div>
      )}

      {node.type === 'extraction' && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-[12px] font-medium text-gray-500">Fields to collect</label>
            <button onClick={onAddExtractField} className="text-[12px] font-medium text-blue-600 hover:text-blue-700">+ Add</button>
          </div>
          <div className="space-y-1.5">
            {Object.entries(node.extract || {}).map(([key]) => (
              <div key={key} className="flex gap-1.5">
                <input defaultValue={key} onBlur={(e) => onUpdateExtractField(key, e.target.value, node.extract![key])} placeholder="field name" className="flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-mono text-[12px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                <button onClick={() => onRemoveExtractField(key)} className="px-1.5 text-gray-400 hover:text-red-500">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {node.type === 'function' && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-500">Function name</label>
            <input value={node.function || ''} onChange={(e) => onUpdate({ function: e.target.value })} placeholder="check_availability" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-500">Webhook URL</label>
            <input value={node.params?.webhookUrl || ''} onChange={(e) => onUpdate({ params: { ...node.params, webhookUrl: e.target.value } })} placeholder="https://..." className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </div>
        </div>
      )}

      {node.type === 'transfer' && (
        <div>
          <label className="mb-1 block text-[12px] font-medium text-gray-500">Transfer to</label>
          <input value={node.params?.transferTo || ''} onChange={(e) => onUpdate({ params: { ...node.params, transferTo: e.target.value } })} placeholder="+1..." className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        </div>
      )}

      {node.type === 'payment' && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-500">Amount (0 = tokenize only)</label>
            <input value={node.params?.amount || '0'} onChange={(e) => onUpdate({ params: { ...node.params, amount: e.target.value } })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-500">Pay Connector name</label>
            <input value={node.params?.paymentConnector || 'Default'} onChange={(e) => onUpdate({ params: { ...node.params, paymentConnector: e.target.value } })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </div>
        </div>
      )}

      {node.type === 'press_digit' && (
        <div>
          <label className="mb-1 block text-[12px] font-medium text-gray-500">Digits to press</label>
          <input value={node.params?.digits || ''} onChange={(e) => onUpdate({ params: { ...node.params, digits: e.target.value } })} placeholder="e.g. 2{{account_number}}#" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        </div>
      )}

      {node.type === 'sms' && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-500">Send to</label>
            <input value={node.params?.to || ''} onChange={(e) => onUpdate({ params: { ...node.params, to: e.target.value } })} placeholder="Blank = caller's own number" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-500">Message</label>
            <textarea value={node.params?.body || ''} onChange={(e) => onUpdate({ params: { ...node.params, body: e.target.value } })} rows={3} className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </div>
        </div>
      )}

      {node.type === 'code' && (
        <div>
          <label className="mb-1 block text-[12px] font-medium text-gray-500">JavaScript</label>
          <textarea value={node.params?.code || ''} onChange={(e) => onUpdate({ params: { ...node.params, code: e.target.value } })} rows={8} spellCheck={false} className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[11.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        </div>
      )}

      {node.type === 'mcp' && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-500">MCP server URL</label>
            <input value={node.params?.serverUrl || ''} onChange={(e) => onUpdate({ params: { ...node.params, serverUrl: e.target.value } })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-500">Tool name</label>
            <input value={node.params?.toolName || ''} onChange={(e) => onUpdate({ params: { ...node.params, toolName: e.target.value } })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-500">Arguments (JSON)</label>
            <input value={node.params?.toolArguments || ''} onChange={(e) => onUpdate({ params: { ...node.params, toolArguments: e.target.value } })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </div>
        </div>
      )}

      {node.type === 'subagent' && (
        <div>
          <label className="mb-1 block text-[12px] font-medium text-gray-500">Tools (JSON array)</label>
          <textarea value={node.params?.tools || ''} onChange={(e) => onUpdate({ params: { ...node.params, tools: e.target.value } })} rows={8} spellCheck={false} className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[11px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        </div>
      )}

      {node.type === 'subflow_ref' && (
        <SubflowRefFields node={node} onUpdate={onUpdate} subflows={subflows || []} onCreateSubflow={onCreateSubflow} />
      )}

      {node.type !== 'logic_split' && node.type !== 'press_digit' && (
        <div className="space-y-3 border-t border-gray-100 pt-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-500">Interruption sensitivity</label>
            <select value={node.params?.interruptionSensitivity || 'medium'} onChange={(e) => onUpdate({ params: { ...node.params, interruptionSensitivity: e.target.value } })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100">
              <option value="high">High (interrupt on any word)</option>
              <option value="medium">Medium (default — needs ~2 words)</option>
              <option value="low">Low (needs ~3 words)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-500">Response wait time (ms)</label>
            <input type="number" min={0} max={10000} value={node.params?.responseWaitTimeMs || ''} onChange={(e) => onUpdate({ params: { ...node.params, responseWaitTimeMs: e.target.value } })} placeholder="0" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </div>
        </div>
      )}

      <div className="border-t border-gray-100 pt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-[12px] font-medium text-gray-500">
            {node.type === 'logic_split' ? 'Edges (code-evaluated)' : node.type === 'press_digit' ? 'Edge (always follows)' : 'Edges'}
          </label>
          {!(node.type === 'press_digit' && node.edges.length >= 1) && (
            <button onClick={onAddEdge} className="text-[12px] font-medium text-blue-600 hover:text-blue-700">+ Add</button>
          )}
        </div>
        <div className="space-y-2">
          {node.edges.map((edge, i) => (
            <div key={edge.id} className="space-y-1.5 rounded-lg border border-gray-100 p-2">
              {node.type === 'press_digit' ? null : node.type === 'logic_split' ? (
                <div className="flex flex-wrap gap-1.5">
                  <input
                    value={typeof edge.condition === 'object' ? edge.condition.field : ''}
                    onChange={(e) => onUpdateEdge(i, { condition: { field: e.target.value, operator: typeof edge.condition === 'object' ? edge.condition.operator : '==', value: typeof edge.condition === 'object' ? edge.condition.value : '' } })}
                    placeholder="field"
                    className="w-24 rounded-lg border border-gray-200 bg-white px-2 py-1 font-mono text-[11.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <select
                    value={typeof edge.condition === 'object' ? edge.condition.operator : '=='}
                    onChange={(e) => onUpdateEdge(i, { condition: { field: typeof edge.condition === 'object' ? edge.condition.field : '', operator: e.target.value as StructuredCondition['operator'], value: typeof edge.condition === 'object' ? edge.condition.value : '' } })}
                    className="rounded-lg border border-gray-200 bg-white px-1.5 py-1 font-mono text-[11.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    {CONDITION_OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
                  </select>
                  <input
                    value={typeof edge.condition === 'object' ? edge.condition.value : ''}
                    onChange={(e) => onUpdateEdge(i, { condition: { field: typeof edge.condition === 'object' ? edge.condition.field : '', operator: typeof edge.condition === 'object' ? edge.condition.operator : '==', value: e.target.value } })}
                    placeholder="value (blank=default)"
                    className="flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1 font-mono text-[11.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              ) : (
                <input
                  value={typeof edge.condition === 'string' ? edge.condition : ''}
                  onChange={(e) => onUpdateEdge(i, { condition: e.target.value })}
                  placeholder="condition, e.g. caller wants to book"
                  className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              )}
              <div className="flex items-center gap-1.5">
                <span className="text-[11.5px] text-gray-400">→</span>
                <select
                  value={edge.target}
                  onChange={(e) => onUpdateEdge(i, { target: e.target.value })}
                  className="flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[12px] font-mono focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">target…</option>
                  {allNodes.filter((n) => n.id && n._key !== node._key).map((n) => (
                    <option key={n._key} value={n.id}>{n.id}</option>
                  ))}
                </select>
                <button onClick={() => onRemoveEdge(i)} className="px-1 text-gray-400 hover:text-red-500">✕</button>
              </div>
            </div>
          ))}
          {node.edges.length === 0 && <p className="text-[11.5px] text-gray-400">No edges — terminal node.</p>}
        </div>
      </div>

      <div className="border-t border-gray-100 pt-3">
        <button onClick={onRemove} className="text-[12.5px] font-medium text-red-500 hover:text-red-600">Remove node</button>
      </div>
    </div>
  );
}

// A subflow_ref node's only real config is which subflow it points at —
// everything else about it (its edges/conditions) is defined on THIS node
// exactly like any other node's edges, and doubles as the subflow's exit
// paths once execution returns from inside it (see call-loop-poc's
// _enterSubflow/_applyTransition — the subflow's own terminal nodes hand
// control back to this node's real edges, not a synthetic "return").
function SubflowRefFields({
  node,
  onUpdate,
  subflows,
  onCreateSubflow,
}: {
  node: DraftNode;
  onUpdate: (patch: Partial<DraftNode>) => void;
  subflows: Subflow[];
  onCreateSubflow?: (name: string) => Promise<Subflow | null>;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const selected = subflows.find((s) => s.id === node.params?.subflowId);

  const handleCreate = async () => {
    if (!onCreateSubflow) return;
    setIsCreating(true);
    try {
      const created = await onCreateSubflow(`Subflow for ${node.id || 'node'}`);
      if (created) onUpdate({ params: { ...node.params, subflowId: created.id } });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-[12px] font-medium text-gray-500">Subflow</label>
        <div className="flex gap-2">
          <select
            value={node.params?.subflowId || ''}
            onChange={(e) => onUpdate({ params: { ...node.params, subflowId: e.target.value } })}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          >
            <option value="">Select a subflow…</option>
            {subflows.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.nodes.length} nodes{s.scope === 'library' ? ' — library' : ''})</option>
            ))}
          </select>
          <button type="button" onClick={handleCreate} disabled={isCreating} className="shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-[12.5px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">
            {isCreating ? 'Creating…' : '+ New'}
          </button>
        </div>
      </div>
      {selected && (
        <a
          href={`/dashboard/subflows/${selected.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-[12.5px] font-medium text-blue-600 hover:text-blue-700"
        >
          Edit &ldquo;{selected.name}&rdquo; ({selected.nodes.length} node{selected.nodes.length === 1 ? '' : 's'}) →
        </a>
      )}
      {!node.params?.subflowId && (
        <p className="text-[12px] text-amber-600">Pick or create a subflow — this node won&apos;t do anything until it references one.</p>
      )}
    </div>
  );
}

function SimulationTab({ agentId }: { agentId: string }) {
  interface TestCase {
    id: string;
    name: string;
    user_prompt: string;
    success_criteria: string;
    created_at: string;
  }
  interface RunResult {
    id: string;
    passed: boolean;
    reasoning: string;
    transcript: { role: 'caller' | 'agent'; content: string }[];
  }
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const [successCriteria, setSuccessCriteria] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  // Best-of-N (2026-09-17): these simulations are inherently non-
  // deterministic — both the synthetic caller and the agent are freshly
  // LLM-generated each run — so a single Pass/Fail conflates "the flow is
  // actually broken" with "this one run went sideways." Each test case now
  // keeps every run from its last batch, and the badge shows a pass RATE
  // (e.g. "4/5") instead of one binary verdict.
  const [runsPerTest, setRunsPerTest] = useState(3);
  const [runResults, setRunResults] = useState<Record<string, RunResult[]>>({});
  const [expandedTranscriptId, setExpandedTranscriptId] = useState<string | null>(null);
  const [expandedRunIndex, setExpandedRunIndex] = useState(0);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/test-cases`);
      const body = await res.json();
      if (res.ok) setTestCases(body.testCases || []);
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!name.trim() || !userPrompt.trim() || !successCriteria.trim()) {
      setError('Name, user prompt, and success criteria are all required');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/test-cases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, userPrompt, successCriteria }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setTestCases((prev) => [body.testCase, ...prev]);
      setShowForm(false);
      setName(''); setUserPrompt(''); setSuccessCriteria('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create test case');
    } finally {
      setIsSaving(false);
    }
  };

  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/test-cases/generate`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setTestCases((prev) => [...(body.testCases || []), ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate test cases');
    } finally {
      setIsGenerating(false);
    }
  };

  const runOnce = async (testCaseId: string): Promise<RunResult> => {
    const res = await fetch(`/api/agents/${agentId}/test-cases/${testCaseId}/run`, { method: 'POST' });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    return body.run;
  };

  // Fires runsPerTest simulations for this test case concurrently. A single
  // failed run (network hiccup, model error) doesn't lose the others —
  // Promise.allSettled, not Promise.all — but does surface an error banner
  // so a systemic failure (e.g. no published version) isn't silently eaten.
  const handleRun = async (testCaseId: string, { expandOnFinish = true } = {}) => {
    setRunningIds((prev) => new Set(prev).add(testCaseId));
    setError(null);
    try {
      const settled = await Promise.allSettled(
        Array.from({ length: runsPerTest }, () => runOnce(testCaseId))
      );
      const succeeded = settled.filter((s) => s.status === 'fulfilled').map((s) => (s as PromiseFulfilledResult<RunResult>).value);
      const failures = settled.filter((s) => s.status === 'rejected');
      if (succeeded.length > 0) {
        setRunResults((prev) => ({ ...prev, [testCaseId]: succeeded }));
        setExpandedRunIndex(0);
        if (expandOnFinish) setExpandedTranscriptId(testCaseId);
      }
      if (failures.length > 0) {
        const first = failures[0] as PromiseRejectedResult;
        setError(`${failures.length} of ${runsPerTest} run(s) failed to complete: ${first.reason instanceof Error ? first.reason.message : String(first.reason)}`);
      }
    } finally {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(testCaseId);
        return next;
      });
    }
  };

  // Fires every test case's run concurrently rather than one-at-a-time —
  // each is independent (its own transcript, its own judge call), and
  // runningIds (a Set, not a single id) already supports several showing
  // "Running…" at once, which is exactly the bug report that prompted this:
  // clicking Run on a second row used to silently revert the first row's
  // button back to "Run" even though that request was still in flight.
  const handleRunAll = () => {
    for (const tc of testCases) {
      if (!runningIds.has(tc.id)) handleRun(tc.id, { expandOnFinish: false });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/agents/${agentId}/test-cases/${id}`, { method: 'DELETE' });
      setTestCases((prev) => prev.filter((t) => t.id !== id));
    } catch {
      // best-effort
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-[#1a1d29]">Simulation Testing</h2>
          <p className="mt-0.5 text-[12.5px] text-gray-500">A synthetic caller converses with this agent's published flow over text, then a judge model scores the transcript.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12.5px] text-gray-500">
            Runs per test
            <select
              value={runsPerTest}
              onChange={(e) => setRunsPerTest(Number(e.target.value))}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[12.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              <option value={1}>1</option>
              <option value={3}>3</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
            </select>
          </label>
          <button
            onClick={handleRunAll}
            disabled={testCases.length === 0 || runningIds.size > 0}
            title="Runs every test case below concurrently"
            className="rounded-lg border border-gray-200 px-4 py-2 text-[13px] font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            {runningIds.size > 0 ? `Running ${runningIds.size}…` : '▶ Run all'}
          </button>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            title="Drafts test cases from this agent's own published flow — its real branches, not generic ones"
            className="rounded-lg border border-gray-200 px-4 py-2 text-[13px] font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            {isGenerating ? 'Generating…' : '✨ Generate from workflow'}
          </button>
          <button onClick={() => setShowForm(true)} className="rounded-lg bg-[#1a1d29] px-4 py-2 text-[13px] font-medium text-white transition hover:bg-[#2a2e3d]">
            + Test Case
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">{error}</div>}

      {showForm && (
        <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">Test case name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Books an appointment" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">User prompt</label>
              <input value={userPrompt} onChange={(e) => setUserPrompt(e.target.value)} placeholder="I'd like to book an appointment for Monday" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-gray-500">Success criteria</label>
              <input value={successCriteria} onChange={(e) => setSuccessCriteria(e.target.value)} placeholder="Agent confirms a real booked time" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="rounded-lg px-3.5 py-1.5 text-[12.5px] font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={handleCreate} disabled={isSaving} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60 text-[11px] uppercase tracking-wide text-gray-400">
              <th className="px-5 py-3 font-medium">Test Case</th>
              <th className="px-5 py-3 font-medium">User Prompt</th>
              <th className="px-5 py-3 font-medium">Success Criteria</th>
              <th className="px-5 py-3 font-medium">Last Run</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-gray-400">Loading…</td></tr>
            ) : testCases.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-gray-400">No test cases yet.</td></tr>
            ) : (
              testCases.map((tc) => {
                const runs = runResults[tc.id];
                const isExpanded = expandedTranscriptId === tc.id;
                const passCount = runs?.filter((r) => r.passed).length ?? 0;
                const activeRun = runs?.[Math.min(expandedRunIndex, runs.length - 1)];
                return (
                  <Fragment key={tc.id}>
                    <tr className="group border-b border-gray-50 last:border-0 hover:bg-gray-50/70">
                      <td className="px-5 py-3 font-medium text-[#1a1d29]">{tc.name}</td>
                      <td className="max-w-[220px] truncate px-5 py-3 text-gray-600">{tc.user_prompt}</td>
                      <td className="max-w-[220px] truncate px-5 py-3 text-gray-600">{tc.success_criteria}</td>
                      <td className="px-5 py-3">
                        {runs ? (
                          <button
                            onClick={() => {
                              setExpandedRunIndex(0);
                              setExpandedTranscriptId(isExpanded ? null : tc.id);
                            }}
                            title={`${passCount} of ${runs.length} run(s) passed`}
                            className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${
                              passCount === runs.length ? 'bg-green-50 text-green-700' : passCount === 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {passCount}/{runs.length} passed
                          </button>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => handleRun(tc.id)}
                            disabled={runningIds.has(tc.id)}
                            className="text-[12px] font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
                          >
                            {runningIds.has(tc.id) ? 'Running…' : 'Run'}
                          </button>
                          <button onClick={() => handleDelete(tc.id)} className="text-[12px] text-gray-300 opacity-0 transition hover:text-red-500 group-hover:opacity-100">Delete</button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && runs && activeRun && (
                      <tr className="border-b border-gray-50 bg-gray-50/50 last:border-0">
                        <td colSpan={5} className="px-5 py-4">
                          {runs.length > 1 && (
                            <div className="mb-3 flex flex-wrap gap-1.5">
                              {runs.map((r, i) => (
                                <button
                                  key={r.id}
                                  onClick={() => setExpandedRunIndex(i)}
                                  className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition ${
                                    i === expandedRunIndex
                                      ? 'bg-[#1a1d29] text-white'
                                      : r.passed
                                        ? 'bg-green-50 text-green-700 hover:bg-green-100'
                                        : 'bg-red-50 text-red-700 hover:bg-red-100'
                                  }`}
                                >
                                  Run {i + 1} {r.passed ? '✓' : '✗'}
                                </button>
                              ))}
                            </div>
                          )}
                          <p className="mb-2 text-[12.5px] text-gray-600"><span className="font-medium text-[#1a1d29]">Verdict:</span> {activeRun.reasoning}</p>
                          <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3">
                            {activeRun.transcript.map((t, i) => (
                              <p key={i} className="text-[12.5px]">
                                <span className={`font-medium ${t.role === 'caller' ? 'text-blue-600' : 'text-gray-700'}`}>{t.role === 'caller' ? 'Caller' : 'Agent'}:</span>{' '}
                                <span className="text-gray-600">{t.content}</span>
                              </p>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NodeTypeIcon({ type }: { type: FlowNode['type'] }) {
  return <span className="inline-block h-2 w-2 flex-none rounded-full bg-gray-300" style={{ backgroundColor: TYPE_DOT_COLORS[type] || '#9ca3af' }} />;
}

const TYPE_DOT_COLORS: Record<string, string> = {
  greeting: '#3b82f6', extraction: '#3b82f6', function: '#8b5cf6', code: '#8b5cf6', mcp: '#8b5cf6',
  subagent: '#6366f1', knowledge_base: '#14b8a6', transfer: '#f97316', press_digit: '#f97316',
  payment: '#22c55e', sms: '#ec4899', logic_split: '#eab308', goodbye: '#6b7280',
};

function BackIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>;
}
function AgentRailIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="8" width="16" height="11" rx="2" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /><circle cx="9" cy="13.5" r="1" fill="currentColor" /><circle cx="15" cy="13.5" r="1" fill="currentColor" /></svg>;
}
function WorkflowIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M8 7.5 10.5 16" /><path d="M16 7.5 13.5 16" /></svg>;
}
function SimulationIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V2" /><path d="M9 2h6" /></svg>;
}
function EditPencilIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>;
}
