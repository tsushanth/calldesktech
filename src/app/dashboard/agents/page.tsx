'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOnboarding } from '@/context/OnboardingContext';
import { formatPhoneDisplay } from '@/lib/utils';
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
      router.push(`/dashboard/agents/${body.agent.id}${channel === 'text' ? '?channel=text' : ''}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent');
      setIsCreating(false);
    }
  };

  const startEditing = (agent: Agent) => {
    setEditingId(agent.id);
    setNameDraft(agent.name);
  };

  const handleSaveName = async (agentId: string) => {
    if (!nameDraft.trim()) {
      setEditingId(null);
      return;
    }
    setIsSavingName(true);
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameDraft.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setAgents((prev) => prev.map((a) => (a.id === agentId ? body.agent : a)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename agent');
    } finally {
      setIsSavingName(false);
    }
  };

  const handleDelete = async (agentId: string) => {
    setDeletingId(agentId);
    try {
      const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to delete agent');
      setAgents((prev) => prev.filter((a) => a.id !== agentId));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete agent');
    } finally {
      setDeletingId(null);
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
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Voice</th>
              <th className="px-5 py-3 font-medium">Phone</th>
              <th className="px-5 py-3 font-medium">Mode</th>
              <th className="px-5 py-3 font-medium">Last Updated</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-14 text-center text-gray-400">
                  {agents.length === 0 ? 'No agents yet — create one to start building a version.' : 'No agents match your search.'}
                </td>
              </tr>
            ) : (
              filtered.map((agent) => (
                <tr key={agent.id} className="group border-b border-gray-50 last:border-0 hover:bg-gray-50/70">
                  <td className="px-5 py-3.5">
                    {editingId === agent.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={nameDraft}
                          onChange={(e) => setNameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveName(agent.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          disabled={isSavingName}
                          className="rounded-lg border border-gray-200 px-2.5 py-1 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                        <button onClick={() => handleSaveName(agent.id)} disabled={isSavingName} className="text-[12.5px] font-medium text-blue-600 hover:text-blue-700">
                          Save
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-[12.5px] text-gray-400 hover:text-gray-600">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <Link href={`/dashboard/agents/${agent.id}`} className="flex items-center gap-2.5 font-medium text-[#1a1d29] hover:text-blue-600">
                        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-blue-50 text-blue-500">
                          <AgentIcon />
                        </span>
                        {agent.name}
                      </Link>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    {agent.latestVersion ? (
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${
                          agent.latestVersion.voiceEngine === 'poc' ? 'bg-teal-50 text-teal-700' : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        {agent.latestVersion.voiceEngine === 'poc' ? 'CallDeskTech' : 'Retell'}
                      </span>
                    ) : (
                      <span className="text-gray-300">No version yet</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-gray-600">
                    {agent.latestVersion?.voice ? (
                      agent.latestVersion.voice === 'kokoro' ? 'CallDeskTech' : agent.latestVersion.voice
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 font-mono text-gray-600">
                    {agent.phoneNumbers && agent.phoneNumbers.length > 0 ? (
                      agent.phoneNumbers.length === 1 ? (
                        formatPhoneDisplay(agent.phoneNumbers[0])
                      ) : (
                        <span title={agent.phoneNumbers.map(formatPhoneDisplay).join(', ')}>
                          {formatPhoneDisplay(agent.phoneNumbers[0])} +{agent.phoneNumbers.length - 1}
                        </span>
                      )
                    ) : (
                      <span className="font-sans text-gray-300">Unrouted</span>
                    )}
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
                  <td className="px-5 py-3.5 text-gray-500">
                    {new Date(agent.latestVersion?.updatedAt || agent.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3.5">
                    {editingId !== agent.id && (
                      <div className="flex items-center justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                        <button
                          onClick={() => startEditing(agent)}
                          title="Rename"
                          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        >
                          <EditIcon />
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(agent.id)}
                          title="Delete"
                          className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {confirmDeleteId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={() => setConfirmDeleteId(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1.5 text-[16px] font-semibold text-[#1a1d29]">Delete this agent?</h2>
            <p className="mb-5 text-[13px] text-gray-500">
              This permanently deletes the agent and all of its versions. Any phone number currently routed to one of its versions will become unrouted. This can&apos;t be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-lg px-4 py-2 text-[13.5px] font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={deletingId === confirmDeleteId}
                className="rounded-lg bg-red-600 px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {deletingId === confirmDeleteId ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
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

function EditIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}
