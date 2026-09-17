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

type DraftNode = FlowNode & { _key: string };

interface FlowVisualEditorProps {
  nodes: DraftNode[];
  startNodeId: string;
  onPositionChange: (nodeKey: string, position: { x: number; y: number }) => void;
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
  subagent: { accent: '#6366f1', badgeBg: '#eef2ff', badgeText: '#4f46e5' },
  knowledge_base: { accent: '#14b8a6', badgeBg: '#f0fdfa', badgeText: '#0d9488' },
  transfer: { accent: '#f97316', badgeBg: '#fff7ed', badgeText: '#ea580c' },
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
  const positions: Record<string, { x: number; y: number }> = {};
  for (const [depth, colNodes] of columns) {
    colNodes.forEach((n, i) => {
      positions[n.id] = { x: depth * COL_WIDTH, y: i * ROW_HEIGHT };
    });
  }
  return positions;
}

function FlowNodeCard({ data }: NodeProps) {
  const node = data.node as DraftNode;
  const isStart = data.isStart as boolean;
  const color = TYPE_COLORS[node.type] || DEFAULT_TYPE_COLOR;
  const paramEntries = node.params ? Object.entries(node.params).filter(([, v]) => v) : [];
  return (
    <div
      className="w-[340px] rounded-xl border bg-white shadow-md transition-shadow hover:shadow-lg"
      style={{ borderColor: isStart ? color.accent : '#e5e7eb', borderLeftWidth: 5, borderLeftColor: color.accent, borderWidth: isStart ? 2 : 1 }}
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
        {node.prompt && (
          <p className="mt-2.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-gray-600">{node.prompt}</p>
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
      </div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white" style={{ background: color.accent }} />
    </div>
  );
}

const nodeTypes: NodeTypes = { flowNode: FlowNodeCard };

export default function FlowVisualEditor({ nodes, startNodeId, onPositionChange }: FlowVisualEditorProps) {
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
        data: { node: n, isStart: n.id === startNodeId },
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
  }, [nodes, startNodeId, setRfNodes, setRfEdges]);

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: RFNode) => {
      onPositionChange(node.id, node.position);
    },
    [onPositionChange]
  );

  return (
    <div className="h-[720px] w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={handleNodeDragStop}
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
