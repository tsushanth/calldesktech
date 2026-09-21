'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useOnboarding } from '@/context/OnboardingContext';
import { notifyPhoneNumbersChanged } from '@/lib/events';
import type { PhoneNumber, Agent, AgentVersion, AgentEnvironment } from '@/types';

const ENV_PREFIX = 'env:';

// Mirrors Retell's own Phone Numbers screen: a list on the left, and on the
// right an Inbound Call Agent dropdown and a separate Outbound Call Agent
// dropdown for whichever number is selected — each one routes to a specific
// agent VERSION, not just "the agent" (see the "Two-Tier Onboarding" design
// doc for why). Picking a version here is what "activation" means in this
// model, and re-picking an older one is how rollback works.
export default function PhoneNumbersPage() {
  const router = useRouter();
  const { tenantId, isHydrated } = useOnboarding();
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [versionsByAgent, setVersionsByAgent] = useState<Record<string, AgentVersion[]>>({});
  const [environmentsByAgent, setEnvironmentsByAgent] = useState<Record<string, AgentEnvironment[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newNumber, setNewNumber] = useState('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBuying, setIsBuying] = useState(false);
  const [buyAreaCode, setBuyAreaCode] = useState('');
  const [billingPrompt, setBillingPrompt] = useState<{ message: string; action: 'checkout' | 'billing_portal' } | null>(null);
  const [showCallModal, setShowCallModal] = useState(false);
  const [callToNumber, setCallToNumber] = useState('');
  const [isCalling, setIsCalling] = useState(false);
  const [callResult, setCallResult] = useState<{ sid: string; to: string } | null>(null);
  const [callError, setCallError] = useState<string | null>(null);

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

      const environmentEntries = await Promise.all(
        (agentsBody.agents as Agent[]).map(async (a: Agent) => {
          const res = await fetch(`/api/agents/${a.id}/environments`);
          const body = await res.json();
          return [a.id, res.ok ? body.environments : []] as const;
        })
      );
      setEnvironmentsByAgent(Object.fromEntries(environmentEntries));
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
  const allEnvironments = Object.values(environmentsByAgent).flat();
  const environmentLabel = (env: AgentEnvironment) => {
    const agent = agents.find((a) => a.id === env.agent_id);
    const version = env.version_id ? allVersions.find((v) => v.id === env.version_id) : null;
    const envName = env.name === 'production' ? 'Production' : 'Staging';
    return `${agent?.name || 'Agent'} · ${envName}${version ? ` (currently V${version.version_number})` : ' (nothing promoted yet)'}`;
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
      notifyPhoneNumbersChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add number');
    } finally {
      setIsSaving(false);
    }
  };

  const handleBuyNumber = async () => {
    if (!tenantId) return;
    setIsBuying(true);
    setError(null);
    setBillingPrompt(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/phone-numbers/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ areaCode: buyAreaCode.trim() || undefined }),
      });
      const body = await res.json();
      if (res.status === 402) {
        setBillingPrompt({ message: body.error, action: body.action });
        return;
      }
      if (!res.ok) throw new Error(body.error);
      setNumbers((prev) => [body.phoneNumber, ...prev]);
      setSelectedId(body.phoneNumber.id);
      setBuyAreaCode('');
      notifyPhoneNumbersChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to buy a number');
    } finally {
      setIsBuying(false);
    }
  };

  const handleRoute = async (direction: 'inbound' | 'outbound', selection: string) => {
    if (!selectedId) return;
    setIsSaving(true);
    setError(null);
    try {
      const isEnv = selection.startsWith(ENV_PREFIX);
      const res = await fetch(`/api/phone-numbers/${selectedId}/routing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEnv
            ? { direction, environmentId: selection.slice(ENV_PREFIX.length) }
            : { direction, agentVersionId: selection || null }
        ),
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

  const handleMakeCall = async () => {
    if (!selectedId || !callToNumber.trim()) return;
    setIsCalling(true);
    setCallError(null);
    setCallResult(null);
    try {
      const res = await fetch(`/api/phone-numbers/${selectedId}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toNumber: callToNumber.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to place call');
      setCallResult({ sid: body.call.sid, to: body.call.to });
    } catch (err) {
      setCallError(err instanceof Error ? err.message : 'Failed to place call');
    } finally {
      setIsCalling(false);
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

      {billingPrompt && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-800">
          <span>{billingPrompt.message}</span>
          <a
            href={billingPrompt.action === 'checkout' ? `/pricing?tenantId=${tenantId}` : '/dashboard/billing'}
            className="flex-none rounded-lg bg-amber-800 px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-amber-900"
          >
            {billingPrompt.action === 'checkout' ? 'Add billing' : 'Add payment method'}
          </a>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
        {/* Left: number list */}
        <div className="h-fit overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="space-y-2.5 border-b border-gray-100 p-3">
            {/* Was a side-by-side flex-1 input + flex-none button — at this
                column's fixed 300px width, the two together genuinely don't
                fit, and overflow-hidden clipped the button's own text
                instead of wrapping it. Stacked vertically, neither can ever
                clip regardless of column width. */}
            <div className="space-y-1.5">
              <input
                value={buyAreaCode}
                onChange={(e) => setBuyAreaCode(e.target.value)}
                placeholder="Area code (optional)"
                maxLength={3}
                className="w-full rounded-lg border border-gray-200 px-3 py-1.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                onKeyDown={(e) => e.key === 'Enter' && handleBuyNumber()}
              />
              <button
                onClick={handleBuyNumber}
                disabled={isBuying}
                className="w-full rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
              >
                {isBuying ? 'Buying…' : 'Buy a number'}
              </button>
            </div>
            <div className="flex gap-2">
              <input
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
                placeholder="Or register a number you own"
                className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-1.5 font-mono text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                onKeyDown={(e) => e.key === 'Enter' && handleAddNumber()}
              />
              <button
                onClick={handleAddNumber}
                disabled={isSaving || !newNumber.trim()}
                className="flex-none rounded-lg bg-[#1a1d29] px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-[#2a2e3d] disabled:opacity-40"
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
              <div className="flex items-center justify-between">
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-gray-400">Number</p>
                  <p className="font-mono text-[17px] text-[#1a1d29]">{selected.number}</p>
                </div>
                <div className="text-right">
                  <button
                    onClick={() => {
                      setShowCallModal(true);
                      setCallResult(null);
                      setCallError(null);
                    }}
                    disabled={!selected.outbound_agent_version_id}
                    title={!selected.outbound_agent_version_id ? 'Set an Outbound Call Agent first' : undefined}
                    className="flex items-center gap-1.5 rounded-lg bg-[#1a1d29] px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-[#2a2e3d] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <PhoneIcon />
                    Make an outbound call
                  </button>
                  {!selected.outbound_agent_version_id && (
                    <p className="mt-1.5 text-[12px] text-amber-600">
                      Greyed out — set an Outbound Call Agent below first.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <RoutingSection
              title="Inbound Call Agent"
              description="Handles calls placed to this number. Route to an environment (staging/production) so promoting a new version takes effect here automatically, or to a specific version directly."
              value={selected.inbound_environment_id ? `${ENV_PREFIX}${selected.inbound_environment_id}` : selected.inbound_agent_version_id}
              versions={allVersions}
              versionLabel={versionLabel}
              environments={allEnvironments}
              environmentLabel={environmentLabel}
              onChange={(v) => handleRoute('inbound', v)}
              onCreateAgent={() => router.push('/dashboard/agents')}
              disabled={isSaving}
            />

            <RoutingSection
              title="Outbound Call Agent"
              description="Used when placing calls from this number. Leave unset to disable outbound."
              value={selected.outbound_environment_id ? `${ENV_PREFIX}${selected.outbound_environment_id}` : selected.outbound_agent_version_id}
              versions={allVersions}
              versionLabel={versionLabel}
              environments={allEnvironments}
              environmentLabel={environmentLabel}
              onChange={(v) => handleRoute('outbound', v)}
              onCreateAgent={() => router.push('/dashboard/agents')}
              disabled={isSaving}
              allowNone
            />
          </div>
        )}
      </div>

      {showCallModal && selected && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={() => setShowCallModal(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold text-[#1a1d29]">Make an outbound call</h2>
              <button type="button" onClick={() => setShowCallModal(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <p className="mb-4 text-[13px] text-gray-500">
              Places a real call from <span className="font-mono text-[#1a1d29]">{selected.number}</span> using its Outbound Call Agent — the exact flow a real outbound call from this number would run.
            </p>
            <label className="mb-1.5 block text-[12.5px] font-medium text-[#1a1d29]">Destination number</label>
            <input
              value={callToNumber}
              onChange={(e) => {
                setCallToNumber(e.target.value);
                // Editing the destination is what "trying again" means here —
                // clears the placed-call state so the button re-enables.
                setCallResult(null);
              }}
              placeholder="+1..."
              className="mb-4 w-full rounded-lg border border-gray-200 px-3.5 py-2.5 font-mono text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              onKeyDown={(e) => e.key === 'Enter' && !isCalling && !callResult && handleMakeCall()}
            />
            {callError && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">{callError}</div>
            )}
            {callResult && (
              <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3.5 py-2.5 text-[13px] text-green-700">
                Call placed to {callResult.to}. It should be ringing now.
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCallModal(false)}
                className="rounded-lg px-4 py-2 text-[13.5px] font-medium text-gray-600 hover:bg-gray-50"
              >
                Close
              </button>
              <button
                onClick={handleMakeCall}
                disabled={isCalling || !!callResult || !callToNumber.trim()}
                title={callResult ? 'Already placed — edit the number to call again' : undefined}
                className="rounded-lg bg-[#1a1d29] px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-[#2a2e3d] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isCalling ? 'Calling…' : callResult ? 'Called' : 'Call'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const CREATE_AGENT_VALUE = '__create_agent__';

function RoutingSection({
  title,
  description,
  value,
  versions,
  versionLabel,
  environments,
  environmentLabel,
  onChange,
  onCreateAgent,
  disabled,
  allowNone,
}: {
  title: string;
  description: string;
  value: string | null;
  versions: AgentVersion[];
  versionLabel: (v: AgentVersion) => string;
  environments: AgentEnvironment[];
  environmentLabel: (env: AgentEnvironment) => string;
  onChange: (selection: string) => void;
  onCreateAgent: () => void;
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
          onChange={(e) => {
            if (e.target.value === CREATE_AGENT_VALUE) {
              onCreateAgent();
              return;
            }
            onChange(e.target.value);
          }}
          disabled={disabled}
          className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] text-[#1a1d29] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
        >
          <option value="">{allowNone ? 'None (disable outbound)' : 'Select a version…'}</option>
          {environments.length > 0 && (
            <optgroup label="Environments">
              {environments.map((env) => (
                <option key={env.id} value={`${ENV_PREFIX}${env.id}`}>{environmentLabel(env)}</option>
              ))}
            </optgroup>
          )}
          <optgroup label="Specific versions">
            {versions.map((v) => (
              <option key={v.id} value={v.id}>{versionLabel(v)}</option>
            ))}
          </optgroup>
          <option value={CREATE_AGENT_VALUE}>+ Create an agent…</option>
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
