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

// Left-border accent per node type — real signal (what kind of side effect
// this node has), not decoration for its own sake. Mirrors the icon badges
// on Retell's own template cards, just as a color instead of a glyph.
const TYPE_COLORS: Record<string, string> = {
  greeting: '#3b82f6',
  extraction: '#3b82f6',
  function: '#8b5cf6',
  code: '#8b5cf6',
  mcp: '#8b5cf6',
  subagent: '#6366f1',
  knowledge_base: '#14b8a6',
  transfer: '#f97316',
  press_digit: '#f97316',
  payment: '#22c55e',
  sms: '#ec4899',
  logic_split: '#eab308',
  goodbye: '#6b7280',
};

function conditionLabel(condition: string | StructuredCondition | undefined): string {
  if (!condition) return 'default';
  if (typeof condition === 'string') return condition.length > 40 ? `${condition.slice(0, 40)}…` : condition;
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
  const COL_WIDTH = 300;
  const ROW_HEIGHT = 170;
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
  const color = TYPE_COLORS[node.type] || '#9ca3af';
  return (
    <div
      className="w-64 rounded-lg border bg-white shadow-sm"
      style={{ borderColor: isStart ? color : '#e5e7eb', borderLeftWidth: 4, borderLeftColor: color, borderWidth: isStart ? 2 : 1 }}
    >
      <Handle type="target" position={Position.Left} className="!bg-gray-300" />
      <div className="px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[12px] font-medium text-[#1a1d29]">{node.id || '(unnamed)'}</span>
          {isStart && <span className="flex-none rounded-full bg-blue-50 px-1.5 py-0.5 text-[9.5px] font-medium text-blue-600">START</span>}
        </div>
        <p className="mt-0.5 text-[10.5px] font-medium uppercase tracking-wide" style={{ color }}>{node.type}</p>
        {node.prompt && (
          <p className="mt-1 line-clamp-2 text-[11px] text-gray-500">{node.prompt}</p>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-gray-300" />
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
          label: conditionLabel(e.condition),
          labelStyle: { fontSize: 10, fill: '#6b7280' },
          labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
          style: { stroke: '#cbd5e1' },
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
    <div className="h-[600px] w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
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
