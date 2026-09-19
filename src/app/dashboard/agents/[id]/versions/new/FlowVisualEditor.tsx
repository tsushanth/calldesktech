'use client';

import { useMemo, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  MarkerType,
  type Node as RFNode,
  type Edge as RFEdge,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { FlowNode, StructuredCondition } from '@/types';
import { renderMiniMarkdown } from '@/lib/miniMarkdown';

type DraftNode = FlowNode & { _key: string };

interface FlowVisualEditorProps {
  nodes: DraftNode[];
  startNodeId: string;
  onPositionChange: (nodeKey: string, position: { x: number; y: number }) => void;
  selectedKey?: string | null;
  onSelectNode?: (nodeKey: string) => void;
  /** Drag from one node's right handle to another's left handle. */
  onConnectNodes?: (sourceKey: string, targetKey: string) => void;
  /** Select an arrow and press Delete/Backspace. `index` = position in the source node's edges. */
  onDeleteEdges?: (edges: { sourceKey: string; index: number }[]) => void;
  /** subflow id -> display info, for subflow_ref cards. */
  subflowInfo?: Record<string, { name: string; nodeCount: number }>;
  height?: number | string;
}

// Accent + badge color per node type — real signal (what kind of side
// effect this node has), not decoration for its own sake. Mirrors the icon
// badges on Retell's own template cards, just as color instead of a glyph.
const TYPE_COLORS: Record<string, { accent: string; badgeBg: string; badgeText: string }> = {
  greeting: { accent: '#3b82f6', badgeBg: '#eff6ff', badgeText: '#2563eb' },
  extraction: { accent: '#3b82f6', badgeBg: '#eff6ff', badgeText: '#2563eb' },
  function: { accent: '#8b5cf6', badgeBg: '#f5f3ff', badgeText: '#7c3aed' },
  code: { accent: '#8b5cf6', badgeBg: '#f5f3ff', badgeText: '#7c3aed' },
  mcp: { accent: '#8b5cf6', badgeBg: '#f5f3ff', badgeText: '#7c3aed' },
  subflow_ref: { accent: '#7c3aed', badgeBg: '#f5f3ff', badgeText: '#6d28d9' },
  subagent: { accent: '#6366f1', badgeBg: '#eef2ff', badgeText: '#4f46e5' },
  knowledge_base: { accent: '#14b8a6', badgeBg: '#f0fdfa', badgeText: '#0d9488' },
  transfer: { accent: '#f97316', badgeBg: '#fff7ed', badgeText: '#ea580c' },
  extract_variable: { accent: '#0d9488', badgeBg: '#f0fdfa', badgeText: '#0f766e' },
  agent_transfer: { accent: '#ea580c', badgeBg: '#fff7ed', badgeText: '#c2410c' },
  press_digit: { accent: '#f97316', badgeBg: '#fff7ed', badgeText: '#ea580c' },
  payment: { accent: '#22c55e', badgeBg: '#f0fdf4', badgeText: '#16a34a' },
  sms: { accent: '#ec4899', badgeBg: '#fdf2f8', badgeText: '#db2777' },
  logic_split: { accent: '#eab308', badgeBg: '#fefce8', badgeText: '#ca8a04' },
  goodbye: { accent: '#6b7280', badgeBg: '#f9fafb', badgeText: '#4b5563' },
};
const DEFAULT_TYPE_COLOR = { accent: '#9ca3af', badgeBg: '#f9fafb', badgeText: '#6b7280' };

function conditionLabel(condition: string | StructuredCondition | undefined): string {
  if (!condition) return 'default';
  if (typeof condition === 'string') return condition.length > 60 ? `${condition.slice(0, 60)}…` : condition;
  if (!condition.field) return 'default';
  return `${condition.field} ${condition.operator} ${condition.value}`;
}

// Real layout, not a placeholder grid — BFS distance from the start node
// becomes the column, so the diagram reads left-to-right in call order the
// same way Retell's own screenshot does. Nodes unreachable from the start
// (a dead edge target, or an orphaned node someone added but never wired
// up) still get placed, in a trailing column, rather than silently
// vanishing from the canvas. Only used for a node that has no saved
// `position` yet — once dragged, a node's real position always wins.
function computeAutoLayout(nodes: DraftNode[], startNodeId: string): Record<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depthOf = new Map<string, number>();
  if (startNodeId && byId.has(startNodeId)) {
    depthOf.set(startNodeId, 0);
    const queue = [startNodeId];
    while (queue.length) {
      const id = queue.shift() as string;
      const node = byId.get(id);
      const d = depthOf.get(id) ?? 0;
      for (const edge of node?.edges || []) {
        if (edge.target && byId.has(edge.target) && !depthOf.has(edge.target)) {
          depthOf.set(edge.target, d + 1);
          queue.push(edge.target);
        }
      }
    }
  }
  const maxDepth = depthOf.size > 0 ? Math.max(...depthOf.values()) : -1;
  for (const n of nodes) {
    if (!depthOf.has(n.id)) depthOf.set(n.id, maxDepth + 1);
  }

  const columns = new Map<number, DraftNode[]>();
  for (const n of nodes) {
    const d = depthOf.get(n.id) ?? 0;
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d)!.push(n);
  }
  const COL_WIDTH = 380;
  const ROW_HEIGHT = 260;
  // A straight run of single-node columns (the common case: a linear chain)
  // used to put every node at the same y, so each edge was a perfectly
  // horizontal line with its label sitting right on top of it — invisible
  // until you dragged a node off-axis. Alternating a half-row offset by
  // column parity keeps a simple layout but angles every edge enough that
  // its label clears the line.
  const ZIGZAG_OFFSET = ROW_HEIGHT / 2;
  const positions: Record<string, { x: number; y: number }> = {};
  for (const [depth, colNodes] of columns) {
    const baseline = depth % 2 === 1 ? ZIGZAG_OFFSET : 0;
    colNodes.forEach((n, i) => {
      positions[n.id] = { x: depth * COL_WIDTH, y: baseline + i * ROW_HEIGHT };
    });
  }
  return positions;
}

function FlowNodeCard({ data }: NodeProps) {
  const node = data.node as DraftNode;
  const isStart = data.isStart as boolean;
  const isSelected = data.isSelected as boolean;
  const subflow = data.subflow as { id: string; name: string; nodeCount: number } | null;
  // Canvas-only sticky note: no handles (can't be wired), stripped at publish.
  if (node.type === 'note') {
    return (
      <div
        className="w-[240px] cursor-pointer rounded-md border bg-yellow-100 p-3 shadow-md"
        style={{ borderColor: isSelected ? '#2563eb' : '#facc15', borderWidth: isSelected ? 2 : 1 }}
      >
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-yellow-700">Note · not published</p>
        <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-yellow-900">{node.prompt || 'Empty note — edit it in the right panel.'}</p>
      </div>
    );
  }
  const color = TYPE_COLORS[node.type] || DEFAULT_TYPE_COLOR;
  const edgeColor = isSelected ? '#2563eb' : isStart ? color.accent : '#e5e7eb';
  const edgeWidth = isSelected || isStart ? 2 : 1;
  const paramEntries = node.params ? Object.entries(node.params).filter(([, v]) => v) : [];
  return (
    <div
      className="w-[340px] cursor-pointer rounded-xl border bg-white shadow-md transition-shadow hover:shadow-lg"
      style={{
        // Longhand-only: mixing `borderColor`/`borderWidth` with the
        // border-left overrides makes React warn on every re-render.
        borderTopColor: edgeColor,
        borderRightColor: edgeColor,
        borderBottomColor: edgeColor,
        borderLeftColor: color.accent,
        borderTopWidth: edgeWidth,
        borderRightWidth: edgeWidth,
        borderBottomWidth: edgeWidth,
        borderLeftWidth: 5,
        boxShadow: isSelected ? '0 0 0 3px rgba(37,99,235,0.15)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white" style={{ background: color.accent }} />
      <div className="px-4 py-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[13.5px] font-semibold text-[#1a1d29]">{node.id || '(unnamed)'}</span>
          {isStart && <span className="flex-none rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-blue-700">START</span>}
        </div>
        <span
          className="mt-1.5 inline-block rounded-md px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide"
          style={{ backgroundColor: color.badgeBg, color: color.badgeText }}
        >
          {node.type.replace('_', ' ')}
        </span>
        {node.type === 'subflow_ref' && (
          <div className="mt-2.5 rounded-lg bg-violet-50 px-3 py-2">
            {subflow ? (
              <>
                <p className="text-[12.5px] font-medium text-violet-900">{subflow.name}</p>
                <p className="mt-0.5 text-[11px] text-violet-700">
                  {subflow.nodeCount} node{subflow.nodeCount === 1 ? '' : 's'} inside ·{' '}
                  <a href={`/dashboard/subflows/${subflow.id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold underline">Edit</a>
                </p>
              </>
            ) : (
              <p className="text-[11.5px] text-violet-700">No subflow chosen yet — pick one in this node&apos;s settings.</p>
            )}
            <p className="mt-1.5 text-[10.5px] text-violet-600">Drag arrows out of this node for each way the subflow can finish.</p>
          </div>
        )}
        {node.prompt && (
          <div className="mt-2.5 text-[12.5px] leading-relaxed text-gray-600">{renderMiniMarkdown(node.prompt)}</div>
        )}
        {node.extract && Object.keys(node.extract).length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {Object.keys(node.extract).map((field) => (
              <span key={field} className="rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-[10.5px] text-gray-600">{field}</span>
            ))}
          </div>
        )}
        {paramEntries.length > 0 && (node.type === 'function' || node.type === 'mcp' || node.type === 'code' || node.type === 'sms' || node.type === 'transfer' || node.type === 'press_digit' || node.type === 'payment') && (
          <div className="mt-2.5 space-y-0.5 border-t border-gray-100 pt-2">
            {paramEntries.slice(0, 2).map(([key, value]) => (
              <p key={key} className="truncate text-[10.5px] text-gray-400">
                <span className="font-medium text-gray-500">{key}:</span> {String(value)}
              </p>
            ))}
          </div>
        )}
        {node.edges.length > 0 && (
          <div className="mt-2.5 border-t border-gray-100 pt-2">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Transition</p>
            <div className="space-y-1">
              {node.edges.map((edge) => (
                <p key={edge.id} className="flex items-start gap-1.5 text-[11px] text-gray-500">
                  <span className="mt-0.5 flex-none text-gray-300">≡</span>
                  <span className="line-clamp-2">{conditionLabel(edge.condition)} <span className="text-gray-300">→</span> <span className="font-mono">{edge.target || '?'}</span></span>
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white" style={{ background: color.accent }} />
    </div>
  );
}

const nodeTypes: NodeTypes = { flowNode: FlowNodeCard };

export default function FlowVisualEditor({ nodes, startNodeId, onPositionChange, selectedKey, onSelectNode, onConnectNodes, onDeleteEdges, subflowInfo, height = 720 }: FlowVisualEditorProps) {
  const autoLayout = useMemo(() => computeAutoLayout(nodes, startNodeId), [nodes, startNodeId]);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<RFEdge>([]);

  // Re-syncs whenever the flow's real data changes (a prompt/id/edge edited
  // in list view, a node added/removed, or switching back to this tab) —
  // useNodesState/useEdgesState only take their ARGUMENT as an initial seed,
  // not a controlled value, so without this a list-view edit would silently
  // never show up here. Prefers each node's ALREADY-DRAGGED canvas position
  // (from the current rfNodes state) over both the saved position and the
  // auto-layout, so switching tabs back and forth never undoes a drag.
  useEffect(() => {
    setRfNodes((prev) => {
      const prevByKey = new Map(prev.map((rf) => [rf.id, rf]));
      return nodes.map((n) => ({
        id: n._key,
        type: 'flowNode',
        position: prevByKey.get(n._key)?.position || n.position || autoLayout[n.id] || { x: 0, y: 0 },
        data: {
          node: n,
          isStart: n.id === startNodeId,
          isSelected: n._key === selectedKey,
          subflow: n.type === 'subflow_ref' && n.params?.subflowId ? { id: n.params.subflowId, ...(subflowInfo?.[n.params.subflowId] || { name: 'Subflow', nodeCount: 0 }) } : null,
        },
      }));
    });

    const keyById = new Map(nodes.map((n) => [n.id, n._key]));
    const nextEdges: RFEdge[] = [];
    nodes.forEach((n) => {
      (n.edges || []).forEach((e, i) => {
        const targetKey = e.target ? keyById.get(e.target) : undefined;
        if (!targetKey) return;
        nextEdges.push({
          id: `${n._key}-e${i}`,
          source: n._key,
          target: targetKey,
          type: 'smoothstep',
          label: conditionLabel(e.condition),
          labelStyle: { fontSize: 11, fill: '#4b5563', fontWeight: 500 },
          labelBgStyle: { fill: '#ffffff', fillOpacity: 1 },
          labelBgPadding: [6, 3],
          labelBgBorderRadius: 4,
          style: { stroke: '#94a3b8', strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8', width: 18, height: 18 },
        });
      });
    });
    setRfEdges(nextEdges);
    // autoLayout is derived from nodes/startNodeId already; omitting it here
    // avoids re-running this (and clobbering in-progress drags) purely
    // because its object identity changed on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, startNodeId, selectedKey, subflowInfo, setRfNodes, setRfEdges]);

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: RFNode) => {
      onPositionChange(node.id, node.position);
    },
    [onPositionChange]
  );

  const handleConnect = useCallback(
    (c: { source: string | null; target: string | null }) => {
      if (c.source && c.target) onConnectNodes?.(c.source, c.target);
    },
    [onConnectNodes]
  );

  const handleEdgesDelete = useCallback(
    (deleted: RFEdge[]) => {
      // Edge ids are `${sourceKey}-e${index}` (see the sync effect above).
      const parsed = deleted
        .map((e) => {
          const m = /^(.*)-e(\d+)$/.exec(e.id);
          return m ? { sourceKey: m[1], index: Number(m[2]) } : null;
        })
        .filter((x): x is { sourceKey: string; index: number } => x !== null);
      if (parsed.length) onDeleteEdges?.(parsed);
    },
    [onDeleteEdges]
  );

  const handleNodeClick = useCallback(
    (_event: unknown, node: RFNode) => {
      onSelectNode?.(node.id);
    },
    [onSelectNode]
  );

  return (
    <div className="w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50" style={{ height }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={handleNodeClick}
        onConnect={handleConnect}
        onEdgesDelete={handleEdgesDelete}
        deleteKeyCode={['Backspace', 'Delete']}
        connectionRadius={40}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        maxZoom={1.5}
      >
        <Background gap={16} color="#e5e7eb" />
        <Controls />
        <MiniMap pannable zoomable className="!bg-white" />
      </ReactFlow>
    </div>
  );
}
