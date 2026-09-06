'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useOnboarding } from '@/context/OnboardingContext';
import type { Agent } from '@/types';

export default function AgentsPage() {
  const { tenantId, isHydrated } = useOnboarding();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/agents`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setAgents(body.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (isHydrated) loadAgents();
  }, [isHydrated, loadAgents]);

  const handleCreate = async () => {
    if (!tenantId || !newName.trim()) return;
    setIsCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setNewName('');
      setShowCreate(false);
      setAgents((prev) => [body.agent, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent');
    } finally {
      setIsCreating(false);
    }
  };

  const filtered = useMemo(
    () => agents.filter((a) => a.name.toLowerCase().includes(search.toLowerCase())),
    [agents, search]
  );

  if (!isHydrated || isLoading) {
    return <PageSkeleton />;
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold text-[#1a1d29]">Agents</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Each agent is a named line of versions — create one per line of business, or per experiment.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-56 rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-[13.5px] text-[#1a1d29] placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="whitespace-nowrap rounded-lg bg-[#1a1d29] px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-[#2a2e3d]"
          >
            + Create an Agent
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-700">{error}</div>
      )}

      {showCreate && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-3">
          <input
            type="text"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Front Desk, Sales Line"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <button
            onClick={handleCreate}
            disabled={isCreating || !newName.trim()}
            className="whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
          >
            {isCreating ? 'Creating…' : 'Create'}
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60 text-[11.5px] uppercase tracking-wide text-gray-400">
              <th className="px-5 py-3 font-medium">Agent Name</th>
              <th className="px-5 py-3 font-medium">Mode</th>
              <th className="px-5 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-5 py-14 text-center text-gray-400">
                  {agents.length === 0 ? 'No agents yet — create one to start building a version.' : 'No agents match your search.'}
                </td>
              </tr>
            ) : (
              filtered.map((agent) => (
                <tr key={agent.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/70">
                  <td className="px-5 py-3.5">
                    <Link href={`/dashboard/agents/${agent.id}`} className="flex items-center gap-2.5 font-medium text-[#1a1d29] hover:text-blue-600">
                      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-blue-50 text-blue-500">
                        <AgentIcon />
                      </span>
                      {agent.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${
                        agent.mode === 'advanced' ? 'bg-purple-50 text-purple-600' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {agent.mode === 'advanced' ? 'Advanced' : 'Simple (wizard-owned)'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-gray-500">{new Date(agent.created_at).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-40 animate-pulse rounded-lg bg-gray-200" />
      <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="11" rx="2" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      <circle cx="9" cy="13.5" r="1" fill="currentColor" />
      <circle cx="15" cy="13.5" r="1" fill="currentColor" />
    </svg>
  );
}
