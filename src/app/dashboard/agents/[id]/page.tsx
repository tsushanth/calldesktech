'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { Agent, AgentVersion } from '@/types';

export default function AgentDetailPage() {
  const params = useParams();
  const agentId = params.id as string;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGraduateConfirm, setShowGraduateConfirm] = useState(false);
  const [isGraduating, setIsGraduating] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [agentRes, versionsRes] = await Promise.all([
        fetch(`/api/agents/${agentId}`),
        fetch(`/api/agents/${agentId}/versions`),
      ]);
      const agentBody = await agentRes.json();
      if (!agentRes.ok) throw new Error(agentBody.error);
      const versionsBody = await versionsRes.json();
      if (!versionsRes.ok) throw new Error(versionsBody.error);
      setAgent(agentBody.agent);
      setVersions(versionsBody.versions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agent');
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleGraduate = async () => {
    setIsGraduating(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/graduate`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setAgent(body.agent);
      setShowGraduateConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to graduate agent');
    } finally {
      setIsGraduating(false);
    }
  };

  const handleSaveName = async () => {
    if (!agent || !nameDraft.trim() || nameDraft.trim() === agent.name) {
      setIsEditingName(false);
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
      setAgent(body.agent);
      setIsEditingName(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename agent');
    } finally {
      setIsSavingName(false);
    }
  };

  if (isLoading) {
    return <div className="p-10 text-center text-[13.5px] text-gray-400">Loading agent…</div>;
  }

  const isAdvanced = agent?.mode === 'advanced';

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/agents" className="text-[12.5px] text-gray-400 hover:text-[#1a1d29]">
            ← All agents
          </Link>
          {isEditingName ? (
            <div className="mt-1.5 flex items-center gap-2">
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') setIsEditingName(false);
                }}
                disabled={isSavingName}
                className="rounded-lg border border-gray-200 px-2.5 py-1 text-[22px] font-semibold text-[#1a1d29] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <button onClick={handleSaveName} disabled={isSavingName} className="text-[13px] font-medium text-blue-600 hover:text-blue-700">
                Save
              </button>
              <button onClick={() => setIsEditingName(false)} className="text-[13px] text-gray-400 hover:text-gray-600">
                Cancel
              </button>
            </div>
          ) : (
            <h1
              className="group mt-1.5 flex cursor-pointer items-center gap-2 text-[22px] font-semibold text-[#1a1d29]"
              onClick={() => {
                setNameDraft(agent?.name || '');
                setIsEditingName(true);
              }}
              title="Click to rename"
            >
              {agent?.name || 'Agent'}
              <svg className="h-4 w-4 text-gray-300 opacity-0 transition group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </h1>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          {!isAdvanced && (
            <button
              onClick={() => setShowGraduateConfirm(true)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-[13px] font-medium text-gray-600 transition hover:bg-gray-50"
            >
              Advanced settings
            </button>
          )}
          <Link
            href={`/dashboard/agents/${agentId}/versions/new`}
            className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-blue-700"
          >
            {versions.length === 0 ? '+ Create first version' : 'Edit'}
          </Link>
        </div>
      </div>

      {error && <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-700">{error}</div>}

      {showGraduateConfirm && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <p className="mb-1.5 text-[13.5px] font-medium text-amber-800">This permanently switches off the wizard for this agent.</p>
          <p className="mb-4 text-[13px] text-amber-700/90">
            Once graduated, edits only happen through versions here — the guided wizard will no longer write to this agent, and there&apos;s no way to switch back.
          </p>
          <div className="flex gap-2.5">
            <button
              onClick={handleGraduate}
              disabled={isGraduating}
              className="rounded-lg bg-amber-500 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-amber-600 disabled:opacity-50"
            >
              {isGraduating ? 'Switching…' : 'Yes, switch to advanced'}
            </button>
            <button
              onClick={() => setShowGraduateConfirm(false)}
              className="rounded-lg border border-amber-200 px-4 py-2 text-[13px] text-amber-700 transition hover:bg-amber-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h2 className="text-[14px] font-semibold text-[#1a1d29]">Versions</h2>
          <span className="text-[12px] text-gray-400">{versions.length} total</span>
        </div>
        {versions.length === 0 ? (
          <div className="p-10 text-center text-[13.5px] text-gray-400">No versions yet — create the first one to give this agent a flow.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60 text-[11.5px] uppercase tracking-wide text-gray-400">
                  <th className="px-5 py-3 font-medium">Version</th>
                  <th className="px-5 py-3 font-medium">Engine</th>
                  <th className="px-5 py-3 font-medium">Voice / TTS</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/70">
                    <td className="px-5 py-3.5 font-mono text-[#1a1d29]">V{v.version_number}</td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${
                          v.voice_engine === 'poc' ? 'bg-teal-50 text-teal-700' : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        {v.voice_engine}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">
                      {v.voice_id || '—'} {v.tts_backend ? `· ${v.tts_backend}` : ''}
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{new Date(v.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-4 text-[12.5px] text-gray-400">
        Route a phone number to any version above on the{' '}
        <Link href="/dashboard/numbers" className="font-medium text-blue-600 hover:text-blue-700">
          Phone Numbers
        </Link>{' '}
        page — that&apos;s what makes a version live, and rolling back is just routing to an older one.
      </p>
    </>
  );
}
