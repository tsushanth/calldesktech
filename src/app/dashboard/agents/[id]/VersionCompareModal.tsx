'use client';

import { useState } from 'react';
import type { AgentVersion, FlowNode } from '@/types';

type Flow = { nodes: FlowNode[]; global_settings: Record<string, unknown> };

// Position is layout-only noise, not a real change.
function normalize(n: FlowNode) {
  const { position, ...rest } = n;
  void position;
  return JSON.stringify(rest);
}

export function diffFlows(a: Flow, b: Flow) {
  const aMap = new Map(a.nodes.map((n) => [n.id, n]));
  const bMap = new Map(b.nodes.map((n) => [n.id, n]));
  const added = b.nodes.filter((n) => !aMap.has(n.id)).map((n) => n.id);
  const removed = a.nodes.filter((n) => !bMap.has(n.id)).map((n) => n.id);
  const changed = b.nodes.filter((n) => aMap.has(n.id) && normalize(aMap.get(n.id)!) !== normalize(n)).map((n) => n.id);
  const keys = Array.from(new Set([...Object.keys(a.global_settings || {}), ...Object.keys(b.global_settings || {})])).sort();
  const settings = keys
    .filter((k) => JSON.stringify(a.global_settings?.[k]) !== JSON.stringify(b.global_settings?.[k]))
    .map((k) => ({ key: k, from: a.global_settings?.[k], to: b.global_settings?.[k] }));
  return { added, removed, changed, settings };
}

const show = (v: unknown) => (v === undefined ? '(unset)' : typeof v === 'string' ? v : JSON.stringify(v));

export default function VersionCompareModal({ versions, onClose }: { versions: AgentVersion[]; onClose: () => void }) {
  const withFlow = versions.filter((v) => v.flow_id);
  const [aId, setAId] = useState(withFlow[1]?.id || '');
  const [bId, setBId] = useState(withFlow[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReturnType<typeof diffFlows> | null>(null);

  const load = async (id: string): Promise<Flow> => {
    const v = versions.find((x) => x.id === id);
    const res = await fetch(`/api/flows/${v?.flow_id}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not load version');
    return { nodes: body.flow.nodes || [], global_settings: body.flow.global_settings || {} };
  };

  const compare = async () => {
    setBusy(true);
    setError(null);
    try {
      const [a, b] = await Promise.all([load(aId), load(bId)]);
      setResult(diffFlows(a, b));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compare failed');
    } finally {
      setBusy(false);
    }
  };

  const sel = 'rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[13px]';
  const label = (id: string) => `V${versions.find((v) => v.id === id)?.version_number}`;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold text-[#1a1d29]">Compare versions</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">✕</button>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select value={aId} onChange={(e) => setAId(e.target.value)} className={sel}>
            {withFlow.map((v) => <option key={v.id} value={v.id}>V{v.version_number}</option>)}
          </select>
          <span className="text-gray-400">→</span>
          <select value={bId} onChange={(e) => setBId(e.target.value)} className={sel}>
            {withFlow.map((v) => <option key={v.id} value={v.id}>V{v.version_number}</option>)}
          </select>
          <button onClick={compare} disabled={busy || !aId || !bId || aId === bId} className="rounded-lg bg-[#1a1d29] px-3.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-40">
            {busy ? 'Comparing…' : 'Compare'}
          </button>
        </div>
        {error && <p className="mb-3 text-[13px] text-red-600">{error}</p>}
        {result && (
          <div className="space-y-4 text-[13px]">
            <p className="text-gray-500">Changes going from {label(aId)} to {label(bId)}.</p>
            <Section title="Nodes added" items={result.added} tone="text-green-700" />
            <Section title="Nodes removed" items={result.removed} tone="text-red-600" />
            <Section title="Nodes changed" items={result.changed} tone="text-amber-700" />
            <div>
              <p className="mb-1 font-medium text-[#1a1d29]">Global settings changed</p>
              {result.settings.length === 0 ? <p className="text-gray-400">None</p> : (
                <ul className="space-y-1">
                  {result.settings.map((s) => (
                    <li key={s.key} className="font-mono text-[12px]">
                      <span className="font-semibold">{s.key}</span>: <span className="text-red-600">{show(s.from)}</span> → <span className="text-green-700">{show(s.to)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return (
    <div>
      <p className="mb-1 font-medium text-[#1a1d29]">{title}</p>
      {items.length === 0 ? <p className="text-gray-400">None</p> : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((id) => <span key={id} className={`rounded-md bg-gray-100 px-2 py-0.5 font-mono text-[12px] ${tone}`}>{id}</span>)}
        </div>
      )}
    </div>
  );
}
