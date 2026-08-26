'use client';

import { useState, useEffect, useCallback } from 'react';
import { useOnboarding } from '@/context/OnboardingContext';
import type { PhoneNumber, Agent, AgentVersion } from '@/types';

// Mirrors Retell's own Phone Numbers screen: a list on the left, and on the
// right an Inbound Call Agent dropdown and a separate Outbound Call Agent
// dropdown for whichever number is selected — each one routes to a specific
// agent VERSION, not just "the agent" (see the "Two-Tier Onboarding" design
// doc for why). Picking a version here is what "activation" means in this
// model, and re-picking an older one is how rollback works.
export default function PhoneNumbersPage() {
  const { tenantId, isHydrated } = useOnboarding();
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [versionsByAgent, setVersionsByAgent] = useState<Record<string, AgentVersion[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newNumber, setNewNumber] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);
    try {
      const [numbersRes, agentsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/phone-numbers`),
        fetch(`/api/tenants/${tenantId}/agents`),
      ]);
      const numbersBody = await numbersRes.json();
      const agentsBody = await agentsRes.json();
      if (!numbersRes.ok) throw new Error(numbersBody.error);
      if (!agentsRes.ok) throw new Error(agentsBody.error);
      setNumbers(numbersBody.phoneNumbers);
      setAgents(agentsBody.agents);
      setSelectedId((prev) => prev || numbersBody.phoneNumbers[0]?.id || null);

      const versionEntries = await Promise.all(
        (agentsBody.agents as Agent[]).map(async (a: Agent) => {
          const res = await fetch(`/api/agents/${a.id}/versions`);
          const body = await res.json();
          return [a.id, res.ok ? body.versions : []] as const;
        })
      );
      setVersionsByAgent(Object.fromEntries(versionEntries));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load phone numbers');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (isHydrated) load();
  }, [isHydrated, load]);

  const allVersions = Object.values(versionsByAgent).flat();
  const versionLabel = (v: AgentVersion) => {
    const agent = agents.find((a) => a.id === v.agent_id);
    return `${agent?.name || 'Agent'} · V${v.version_number} (${v.voice_engine})`;
  };

  const handleAddNumber = async () => {
    if (!tenantId || !newNumber.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/phone-numbers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: newNumber.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setNumbers((prev) => [body.phoneNumber, ...prev]);
      setSelectedId(body.phoneNumber.id);
      setNewNumber('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add number');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRoute = async (direction: 'inbound' | 'outbound', agentVersionId: string) => {
    if (!selectedId) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/phone-numbers/${selectedId}/routing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction, agentVersionId: agentVersionId || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setNumbers((prev) => prev.map((n) => (n.id === selectedId ? body.phoneNumber : n)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to route number');
    } finally {
      setIsSaving(false);
    }
  };

  const selected = numbers.find((n) => n.id === selectedId) || null;

  if (!isHydrated || isLoading) {
    return <div className="p-8 text-center text-gray-400">Loading phone numbers...</div>;
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Phone Numbers</h1>
        <p className="text-gray-400 text-sm mt-1">
          Each number routes inbound and outbound calls to a specific agent version, independently.
        </p>
      </div>

      {error && <div className="mb-6 p-4 rounded-lg bg-red-500/20 text-red-400">{error}</div>}

      <div className="grid grid-cols-[280px_1fr] gap-6">
        {/* Left: number list */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden h-fit">
          <div className="p-4 border-b border-gray-700 flex gap-2">
            <input
              value={newNumber}
              onChange={(e) => setNewNumber(e.target.value)}
              placeholder="+1..."
              className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm font-mono focus:border-blue-500 focus:outline-none"
              onKeyDown={(e) => e.key === 'Enter' && handleAddNumber()}
            />
            <button
              onClick={handleAddNumber}
              disabled={isSaving || !newNumber.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-3 py-1.5 rounded-lg text-sm"
            >
              +
            </button>
          </div>
          {numbers.length === 0 ? (
            <div className="p-6 text-center text-gray-500 text-sm">No numbers yet.</div>
          ) : (
            numbers.map((n) => (
              <button
                key={n.id}
                onClick={() => setSelectedId(n.id)}
                className={`w-full text-left px-4 py-3 border-b border-gray-700 last:border-0 transition ${
                  n.id === selectedId ? 'bg-blue-600/20' : 'hover:bg-gray-700/50'
                }`}
              >
                <p className="font-mono text-sm">{n.number}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {n.inbound_agent_version_id ? 'Inbound routed' : 'No inbound agent'}
                </p>
              </button>
            ))
          )}
        </div>

        {/* Right: detail */}
        {!selected ? (
          <div className="bg-gray-800 border border-dashed border-gray-700 rounded-xl p-12 text-center text-gray-400">
            {numbers.length === 0 ? 'Add a phone number to get started.' : 'Select a number.'}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Number</p>
              <p className="font-mono text-lg">{selected.number}</p>
            </div>

            <RoutingSection
              title="Inbound Call Agent"
              description="Handles calls placed to this number."
              value={selected.inbound_agent_version_id}
              versions={allVersions}
              versionLabel={versionLabel}
              onChange={(v) => handleRoute('inbound', v)}
              disabled={isSaving}
            />

            <RoutingSection
              title="Outbound Call Agent"
              description="Used when placing calls from this number. Leave unset to disable outbound."
              value={selected.outbound_agent_version_id}
              versions={allVersions}
              versionLabel={versionLabel}
              onChange={(v) => handleRoute('outbound', v)}
              disabled={isSaving}
              allowNone
            />
          </div>
        )}
      </div>
    </>
  );
}

function RoutingSection({
  title,
  description,
  value,
  versions,
  versionLabel,
  onChange,
  disabled,
  allowNone,
}: {
  title: string;
  description: string;
  value: string | null;
  versions: AgentVersion[];
  versionLabel: (v: AgentVersion) => string;
  onChange: (versionId: string) => void;
  disabled: boolean;
  allowNone?: boolean;
}) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
      <h2 className="font-semibold mb-1">{title}</h2>
      <p className="text-sm text-gray-400 mb-4">{description}</p>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 focus:border-blue-500 focus:outline-none disabled:opacity-50"
      >
        <option value="">{allowNone ? 'None (disable outbound)' : 'Select a version…'}</option>
        {versions.map((v) => (
          <option key={v.id} value={v.id}>{versionLabel(v)}</option>
        ))}
      </select>
    </div>
  );
}
