'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOnboarding } from '@/context/OnboardingContext';
import type { Subflow } from '@/types';

export default function SubflowsPage() {
  const { tenantId, isHydrated } = useOnboarding();
  const [subflows, setSubflows] = useState<Subflow[]>([]);
  const [agents, setAgents] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);
    try {
      const [sfRes, agRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/subflows`),
        fetch(`/api/tenants/${tenantId}/agents`),
      ]);
      const sf = await sfRes.json();
      const ag = await agRes.json();
      if (!sfRes.ok) throw new Error(sf.error);
      setSubflows(sf.subflows || []);
      setAgents(Object.fromEntries((ag.agents || []).map((a: { id: string; name: string }) => [a.id, a.name])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subflows');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (isHydrated) load();
  }, [isHydrated, load]);

  const share = async (s: Subflow) => {
    if (!window.confirm(`Make "${s.name}" a shared library subflow? Every agent in this workspace will be able to use it.`)) return;
    const res = await fetch(`/api/tenants/${tenantId}/subflows/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'library' }),
    });
    if (!res.ok) setError((await res.json()).error || 'Failed to update subflow');
    await load();
  };

  const remove = async (s: Subflow) => {
    if (!window.confirm(`Delete "${s.name}"? Agents that already published a version using it keep working (they hold a snapshot), but you can't reference it in new versions.`)) return;
    const res = await fetch(`/api/tenants/${tenantId}/subflows/${s.id}`, { method: 'DELETE' });
    if (!res.ok) setError((await res.json()).error || 'Failed to delete subflow');
    await load();
  };

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-[#1a1d29]">Subflows</h1>
        <p className="mt-1 text-[13.5px] text-gray-500">
          Reusable sub-graphs you drop into a flow with a Subflow node. Create one from an agent&apos;s flow editor (add a Subflow node → &ldquo;+ New&rdquo;); manage them here.
        </p>
      </div>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">{error}</div>}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead className="border-b border-gray-100 bg-gray-50 text-[11.5px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th><th className="px-4 py-3">Scope</th><th className="px-4 py-3">Nodes</th><th className="px-4 py-3">Updated</th><th />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
            ) : subflows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No subflows yet.</td></tr>
            ) : (
              subflows.map((s) => (
                <tr key={s.id} className="border-t border-gray-100">
                  <td className="px-4 py-3 font-medium text-[#1a1d29]">{s.name}</td>
                  <td className="px-4 py-3">
                    {s.scope === 'library' ? (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11.5px] font-medium text-blue-700">Shared library</span>
                    ) : (
                      <span className="text-gray-500">Agent: {(s.agentId && agents[s.agentId]) || 'unknown'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{s.nodes.length}</td>
                  <td className="px-4 py-3 text-gray-500">{new Date(s.updatedAt).toLocaleDateString()}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <Link href={`/dashboard/subflows/${s.id}`} className="mr-3 text-[12.5px] font-medium text-blue-600 hover:text-blue-700">Edit</Link>
                    {s.scope !== 'library' && <button onClick={() => share(s)} className="mr-3 text-[12.5px] font-medium text-gray-600 hover:text-gray-800">Share</button>}
                    <button onClick={() => remove(s)} className="text-[12.5px] font-medium text-red-500 hover:text-red-600">Delete</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
