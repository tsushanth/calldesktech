'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOnboarding } from '@/context/OnboardingContext';
import type { Agent } from '@/types';

export default function AgentsPage() {
  const router = useRouter();
  const { tenantId, isHydrated } = useOnboarding();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  // Two real, distinct paths — not just a cosmetic menu. Voice and Text both
  // land in the SAME versions/new wizard (templates, Generate from prompt,
  // node editor) that used to be reachable only by hand-navigating there
  // after creating a bare agent from a plain name field; this dropdown IS
  // the fix for that gap, not a new feature bolted alongside it. Text skips
  // straight past voice-only config in that wizard (see its own ?channel=text
  // handling) since a chat session never touches TTS/STT/Retell voice config
  // at all (chatFlowResolver.ts pins to the newest version's flow regardless
  // of voice_engine).
  const [showCreateMenu, setShowCreateMenu] = useState(false);
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

  // Retell's own Create Agent modal never asks for a name upfront either —
  // it goes straight to Type + Templates, with a default name editable
  // afterward. Auto-naming here (instead of a blocking name prompt) is what
  // actually lets "click Voice/Text Agent -> land in the wizard" happen in
  // one step, matching that.
  const handleCreate = async (channel: 'voice' | 'text') => {
    if (!tenantId) return;
    setShowCreateMenu(false);
    setIsCreating(true);
    setError(null);
    try {
      // Was a flat "New Voice Agent"/"New Text Agent" every time, so a
      // tenant that created a few agents without renaming them ended up with
      // several rows literally indistinguishable in the list ("New Voice
      // Agent" x3, same creation date). "Receptionist"/"Assistant" describes
      // the actual common use case instead of just restating the channel —
      // the list's own "created at" column already shows when it was made,
      // so that doesn't need to live in the name too. Only appends a number
      // if the base name is actually already taken, rather than always
      // stamping every agent with something to disambiguate against agents
      // that don't even exist yet.
      const baseName = channel === 'text' ? 'Text Assistant' : 'Voice Receptionist';
      const existingNames = new Set(agents.map((a) => a.name));
      let defaultName = baseName;
      let n = 2;
      while (existingNames.has(defaultName)) {
        defaultName = `${baseName} ${n}`;
        n++;
      }
      const res = await fetch(`/api/tenants/${tenantId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: defaultName }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      router.push(`/dashboard/agents/${body.agent.id}/versions/new${channel === 'text' ? '?channel=text' : ''}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent');
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
          <div className="relative">
            <button
              onClick={() => setShowCreateMenu((v) => !v)}
              disabled={isCreating}
              className="whitespace-nowrap rounded-lg bg-[#1a1d29] px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-[#2a2e3d] disabled:opacity-60"
            >
              {isCreating ? 'Creating…' : '+ Create an Agent'}
            </button>
            {showCreateMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowCreateMenu(false)} />
                <div className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white py-1.5 shadow-lg">
                  <button
                    onClick={() => handleCreate('voice')}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13.5px] text-[#1a1d29] hover:bg-gray-50"
                  >
                    <PhoneIcon />
                    <div>
                      <p className="font-medium">Voice Agent</p>
                      <p className="text-[11.5px] text-gray-400">Answers real phone calls</p>
                    </div>
                  </button>
                  <button
                    onClick={() => handleCreate('text')}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13.5px] text-[#1a1d29] hover:bg-gray-50"
                  >
                    <ChatIcon />
                    <div>
                      <p className="font-medium">Text Agent</p>
                      <p className="text-[11.5px] text-gray-400">Answers your chat widget</p>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-700">{error}</div>
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

function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-gray-400">
      <path d="M6.5 4h3l1.5 4-2 1.3a11 11 0 0 0 5.7 5.7l1.3-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 5 5.6 1.5 1.5 0 0 1 6.5 4Z" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-gray-400">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
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
