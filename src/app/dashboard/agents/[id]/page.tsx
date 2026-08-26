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

  if (isLoading) {
    return <div className="p-8 text-center text-gray-400">Loading agent...</div>;
  }

  const isAdvanced = agent?.mode === 'advanced';

  return (
    <>
      <div className="flex justify-between items-start mb-8">
        <div>
          <Link href="/dashboard/agents" className="text-sm text-gray-400 hover:text-white">
            ← All agents
          </Link>
          <h1 className="text-2xl font-bold mt-2">{agent?.name || 'Agent'}</h1>
        </div>
        <div className="flex items-center gap-3">
          {!isAdvanced && (
            <button
              onClick={() => setShowGraduateConfirm(true)}
              className="text-sm border border-gray-600 hover:border-gray-400 px-4 py-2 rounded-lg transition"
            >
              Advanced settings
            </button>
          )}
          <Link
            href={`/dashboard/agents/${agentId}/versions/new`}
            className="bg-blue-600 hover:bg-blue-700 px-5 py-2 rounded-lg transition text-sm font-medium"
          >
            + New version
          </Link>
        </div>
      </div>

      {error && <div className="mb-6 p-4 rounded-lg bg-red-500/20 text-red-400">{error}</div>}

      {showGraduateConfirm && (
        <div className="mb-6 p-5 rounded-xl bg-amber-500/10 border border-amber-500/30">
          <p className="font-medium text-amber-200 mb-2">This permanently switches off the wizard for this agent.</p>
          <p className="text-sm text-amber-200/80 mb-4">
            Once graduated, edits only happen through versions here — the guided wizard will no longer write to
            this agent, and there&apos;s no way to switch back.
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleGraduate}
              disabled={isGraduating}
              className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition"
            >
              {isGraduating ? 'Switching...' : 'Yes, switch to advanced'}
            </button>
            <button
              onClick={() => setShowGraduateConfirm(false)}
              className="border border-gray-600 hover:border-gray-400 px-4 py-2 rounded-lg text-sm transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold">Versions</h2>
          <span className="text-xs text-gray-400">{versions.length} total</span>
        </div>
        {versions.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            No versions yet — create the first one to give this agent a flow.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 uppercase tracking-wider">
                <th className="px-6 py-3">Version</th>
                <th className="px-6 py-3">Engine</th>
                <th className="px-6 py-3">Voice / TTS</th>
                <th className="px-6 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-t border-gray-700">
                  <td className="px-6 py-4 font-mono">V{v.version_number}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${
                        v.voice_engine === 'poc' ? 'bg-teal-500/20 text-teal-300' : 'bg-blue-500/20 text-blue-300'
                      }`}
                    >
                      {v.voice_engine}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-400">
                    {v.voice_id || '—'} {v.tts_backend ? `· ${v.tts_backend}` : ''}
                  </td>
                  <td className="px-6 py-4 text-gray-400">{new Date(v.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-500 mt-4">
        Route a phone number to any version above on the{' '}
        <Link href="/dashboard/numbers" className="text-blue-400 hover:text-blue-300">
          Phone Numbers
        </Link>{' '}
        page — that&apos;s what makes a version live, and rolling back is just routing to an older one.
      </p>
    </>
  );
}
