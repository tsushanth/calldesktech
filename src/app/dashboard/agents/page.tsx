'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useOnboarding } from '@/context/OnboardingContext';
import type { Agent } from '@/types';

export default function AgentsPage() {
  const { tenantId, isHydrated } = useOnboarding();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
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
      setAgents((prev) => [body.agent, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent');
    } finally {
      setIsCreating(false);
    }
  };

  if (!isHydrated || isLoading) {
    return <div className="p-8 text-center text-gray-400">Loading agents...</div>;
  }

  return (
    <>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold">Agents</h1>
          <p className="text-gray-400 text-sm mt-1">
            Each agent is a named line of versions — create one per line of business, or per experiment.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-500/20 text-red-400">{error}</div>
      )}

      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 mb-6">
        <h2 className="font-semibold mb-4">New agent</h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Front Desk, Sales Line"
            className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:border-blue-500 focus:outline-none"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <button
            onClick={handleCreate}
            disabled={isCreating || !newName.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:opacity-50 px-6 py-2 rounded-lg transition whitespace-nowrap"
          >
            {isCreating ? 'Creating...' : 'Create agent'}
          </button>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="text-center text-gray-400 py-12 border border-dashed border-gray-700 rounded-xl">
          No agents yet — create one above to start building a version.
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <Link
              key={agent.id}
              href={`/dashboard/agents/${agent.id}`}
              className="block bg-gray-800 border border-gray-700 hover:border-gray-500 rounded-xl p-5 transition"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{agent.name}</p>
                  <p className="text-sm text-gray-400 mt-1">
                    Created {new Date(agent.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span
                  className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    agent.mode === 'advanced'
                      ? 'bg-purple-500/20 text-purple-300'
                      : 'bg-green-500/20 text-green-300'
                  }`}
                >
                  {agent.mode === 'advanced' ? 'Advanced' : 'Simple (wizard-owned)'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
