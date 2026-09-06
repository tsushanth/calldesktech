'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
  const [search, setSearch] = useState('');
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
  const filteredNumbers = useMemo(
    () => numbers.filter((n) => n.number.includes(search.trim())),
    [numbers, search]
  );

  if (!isHydrated || isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-gray-200" />
        <div className="h-96 animate-pulse rounded-xl bg-gray-100" />
      </div>
    );
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-[#1a1d29]">Phone Numbers</h1>
        <p className="mt-0.5 text-[13px] text-gray-500">
          Each number routes inbound and outbound calls to a specific agent version, independently.
        </p>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-700">{error}</div>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
        {/* Left: number list */}
        <div className="h-fit overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="space-y-2 border-b border-gray-100 p-3">
            <div className="flex gap-2">
              <input
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
                placeholder="+1..."
                className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                onKeyDown={(e) => e.key === 'Enter' && handleAddNumber()}
              />
              <button
                onClick={handleAddNumber}
                disabled={isSaving || !newNumber.trim()}
                className="rounded-lg bg-[#1a1d29] px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-[#2a2e3d] disabled:opacity-40"
              >
                +
              </button>
            </div>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search phone numbers"
                className="w-full rounded-lg border border-gray-200 py-1.5 pl-8 pr-3 text-[13px] placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>
          {filteredNumbers.length === 0 ? (
            <div className="p-6 text-center text-[13px] text-gray-400">No numbers yet.</div>
          ) : (
            filteredNumbers.map((n) => (
              <button
                key={n.id}
                onClick={() => setSelectedId(n.id)}
                className={`flex w-full items-center gap-2.5 border-b border-gray-50 px-4 py-3 text-left transition last:border-0 ${
                  n.id === selectedId ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-lg ${n.id === selectedId ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                  <PhoneIcon />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-mono text-[13px] text-[#1a1d29]">{n.number}</p>
                  <p className="mt-0.5 text-[11.5px] text-gray-400">
                    {n.inbound_agent_version_id ? 'Inbound routed' : 'No inbound agent'}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Right: detail */}
        {!selected ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white p-14 text-center text-[13.5px] text-gray-400">
            {numbers.length === 0 ? 'Add a phone number to get started.' : 'Select a number.'}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-gray-400">Number</p>
              <p className="font-mono text-[17px] text-[#1a1d29]">{selected.number}</p>
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
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-[14px] font-semibold text-[#1a1d29]">{title}</h2>
      <p className="mt-0.5 text-[12.5px] text-gray-500">{description}</p>
      <div className="relative mt-3">
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] text-[#1a1d29] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
        >
          <option value="">{allowNone ? 'None (disable outbound)' : 'Select a version…'}</option>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>{versionLabel(v)}</option>
          ))}
        </select>
        <ChevronIcon className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
      </div>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 4h3l1.5 4-2 1.3a11 11 0 0 0 5.7 5.7l1.3-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 5 5.6 1.5 1.5 0 0 1 6.5 4Z" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
