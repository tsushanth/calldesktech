'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useOnboarding } from '@/context/OnboardingContext';
import type { Agent, AgentVersion, BatchCall } from '@/types';

// Mirrors Retell's own "Batch Call" screen: pick one agent VERSION, paste or
// upload a list of phone numbers, and the system dials each one in turn
// through the same outbound path a single call uses. The table below is the
// history of batches, each showing how many of its numbers were placed.
export default function BatchCallPage() {
  const { tenantId, isHydrated } = useOnboarding();
  const [batches, setBatches] = useState<BatchCall[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [versionsByAgent, setVersionsByAgent] = useState<Record<string, AgentVersion[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [versionId, setVersionId] = useState('');
  const [numbersText, setNumbersText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);
    try {
      const [batchesRes, agentsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/batch-calls`),
        fetch(`/api/tenants/${tenantId}/agents`),
      ]);
      const batchesBody = await batchesRes.json();
      const agentsBody = await agentsRes.json();
      if (!batchesRes.ok) throw new Error(batchesBody.error);
      if (!agentsRes.ok) throw new Error(agentsBody.error);
      setBatches(batchesBody.batchCalls);
      setAgents(agentsBody.agents);

      const versionEntries = await Promise.all(
        (agentsBody.agents as Agent[]).map(async (a: Agent) => {
          const res = await fetch(`/api/agents/${a.id}/versions`);
          const body = await res.json();
          return [a.id, res.ok ? body.versions : []] as const;
        })
      );
      setVersionsByAgent(Object.fromEntries(versionEntries));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load batch calls');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (isHydrated) load();
  }, [isHydrated, load]);

  const allVersions = Object.values(versionsByAgent).flat();
  const versionLabel = useCallback(
    (v: AgentVersion | undefined) => {
      if (!v) return 'Deleted version';
      const agent = agents.find((a) => a.id === v.agent_id);
      return `${agent?.name || 'Agent'} · V${v.version_number} (${v.voice_engine})`;
    },
    [agents]
  );

  // Live count of what will be dialed — same split rule the API uses
  // (newlines, commas, semicolons), deduped — so the button reflects reality.
  const parsedNumbers = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of numbersText.split(/[\n,;]+/)) {
      const n = part.trim();
      if (n && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  }, [numbersText]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setNumbersText((prev) => (prev.trim() ? `${prev}\n${text}` : text));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const runBatch = useCallback(async (batchId: string) => {
    setRunningId(batchId);
    setError(null);
    try {
      const res = await fetch(`/api/batch-calls/${batchId}/run`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place batch call');
    } finally {
      setRunningId(null);
      await load();
    }
  }, [load]);

  const handleCreate = async () => {
    if (!tenantId || !versionId || parsedNumbers.length === 0) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/batch-calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentVersionId: versionId, phoneNumbers: numbersText }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setNumbersText('');
      setVersionId('');
      setShowCreate(false);
      setBatches((prev) => [body.batchCall, ...prev]);
      // Creating a batch is inert until triggered — kick it off right away,
      // which places the calls and reloads with the final counts.
      await runBatch(body.batchCall.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create batch call');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isHydrated || isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-gray-200" />
        <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold text-[#1a1d29]">Batch Call</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Dial a list of numbers with one agent version — each number is called in turn.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          disabled={allVersions.length === 0}
          className="whitespace-nowrap rounded-lg bg-[#1a1d29] px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-[#2a2e3d] disabled:opacity-40"
        >
          + Create a Batch Call
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-700">{error}</div>
      )}

      {allVersions.length === 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-700">
          Create an agent version first — a batch call needs a version to dial with.
        </div>
      )}

      {showCreate && (
        <div className="mb-5 space-y-4 rounded-xl border border-gray-200 bg-white p-5">
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[#1a1d29]">Agent version</label>
            <div className="relative">
              <select
                value={versionId}
                onChange={(e) => setVersionId(e.target.value)}
                className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] text-[#1a1d29] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">Select a version…</option>
                {allVersions.map((v) => (
                  <option key={v.id} value={v.id}>{versionLabel(v)}</option>
                ))}
              </select>
              <ChevronIcon className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-[13px] font-medium text-[#1a1d29]">Phone numbers</label>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-[12.5px] font-medium text-blue-600 hover:text-blue-700"
              >
                Upload a file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={handleFile}
                className="hidden"
              />
            </div>
            <textarea
              value={numbersText}
              onChange={(e) => setNumbersText(e.target.value)}
              rows={6}
              placeholder={'+14155551234\n+14155555678\n…one per line, or comma-separated'}
              className="w-full resize-y rounded-lg border border-gray-200 px-3.5 py-2.5 font-mono text-[13px] text-[#1a1d29] placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <p className="mt-1 text-[12px] text-gray-400">
              {parsedNumbers.length} number{parsedNumbers.length === 1 ? '' : 's'} detected.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              disabled={isSubmitting || !versionId || parsedNumbers.length === 0}
              className="whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
            >
              {isSubmitting ? 'Placing calls…' : `Start batch call${parsedNumbers.length ? ` (${parsedNumbers.length})` : ''}`}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-[13.5px] font-medium text-gray-600 transition hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60 text-[11.5px] uppercase tracking-wide text-gray-400">
              <th className="px-5 py-3 font-medium">Agent Version</th>
              <th className="px-5 py-3 font-medium">Numbers</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Created</th>
              <th className="px-5 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-14 text-center text-gray-400">
                  No batch calls yet — create one to dial a list of numbers.
                </td>
              </tr>
            ) : (
              batches.map((batch) => {
                const version = allVersions.find((v) => v.id === batch.agent_version_id);
                return (
                  <tr key={batch.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/70">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5 font-medium text-[#1a1d29]">
                        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-blue-50 text-blue-500">
                          <BatchIcon />
                        </span>
                        {versionLabel(version)}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-gray-600">
                      {batch.called_count ?? 0}/{batch.target_count ?? 0} placed
                      {batch.failed_count ? <span className="ml-1 text-red-500">· {batch.failed_count} failed</span> : null}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={batch.status} />
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{new Date(batch.created_at).toLocaleString()}</td>
                    <td className="px-5 py-3.5 text-right">
                      {batch.status === 'pending' && (
                        <button
                          onClick={() => runBatch(batch.id)}
                          disabled={runningId === batch.id}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
                        >
                          {runningId === batch.id ? 'Running…' : 'Run'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: BatchCall['status'] }) {
  const styles: Record<BatchCall['status'], string> = {
    pending: 'bg-gray-100 text-gray-600',
    running: 'bg-blue-50 text-blue-600',
    completed: 'bg-green-50 text-green-600',
    failed: 'bg-red-50 text-red-600',
  };
  const label: Record<BatchCall['status'], string> = {
    pending: 'Pending',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${styles[status]}`}>
      {label[status]}
    </span>
  );
}

function BatchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 4h3l1.5 4-2 1.3a11 11 0 0 0 5.7 5.7l1.3-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 5 5.6 1.5 1.5 0 0 1 6.5 4Z" />
      <path d="M16 3h5M18.5 5.5v-5" transform="translate(0 3)" />
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
