'use client';

import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useOnboarding } from '@/context/OnboardingContext';
import type { Agent, AgentVersion, BatchCall, BatchCallTarget } from '@/types';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PHONE_COLUMN_NAMES = new Set(['phone', 'phone_number', 'to', 'to_number', 'number']);

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

// Client-side mirror of the API's parseRecipients — used only to show a live
// preview (count + detected variable names) before submitting; the server is
// the real source of truth and re-parses independently.
function previewRecipients(text: string): { count: number; variableNames: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { count: 0, variableNames: [] };
  const header = splitCsvLine(lines[0]).map((f) => f.toLowerCase());
  const phoneColIdx = header.findIndex((f) => PHONE_COLUMN_NAMES.has(f));
  if (phoneColIdx !== -1 && lines.length > 1) {
    const originalHeader = splitCsvLine(lines[0]);
    const varNames = originalHeader.filter((_, i) => i !== phoneColIdx);
    const seen = new Set<string>();
    for (const line of lines.slice(1)) {
      const phone = (splitCsvLine(line)[phoneColIdx] || '').trim();
      if (phone) seen.add(phone);
    }
    return { count: seen.size, variableNames: varNames.filter(Boolean) };
  }
  const seen = new Set<string>();
  for (const part of text.split(/[\n,;]+/)) {
    const n = part.trim();
    if (n) seen.add(n);
  }
  return { count: seen.size, variableNames: [] };
}

export default function BatchCallPage() {
  const { tenantId, isHydrated } = useOnboarding();
  const [batches, setBatches] = useState<BatchCall[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [versionsByAgent, setVersionsByAgent] = useState<Record<string, AgentVersion[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [versionId, setVersionId] = useState('');
  const [numbersText, setNumbersText] = useState('');
  const [timing, setTiming] = useState<'now' | 'schedule'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [windowEnabled, setWindowEnabled] = useState(false);
  const [windowTimezone, setWindowTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [windowDays, setWindowDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [windowStart, setWindowStart] = useState(9);
  const [windowEnd, setWindowEnd] = useState(18);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [targetsByBatch, setTargetsByBatch] = useState<Record<string, BatchCallTarget[]>>({});
  const [loadingTargets, setLoadingTargets] = useState<string | null>(null);

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

  const preview = useMemo(() => previewRecipients(numbersText), [numbersText]);

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

  const toggleExpand = useCallback(async (batchId: string) => {
    if (expandedId === batchId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(batchId);
    if (targetsByBatch[batchId]) return;
    setLoadingTargets(batchId);
    try {
      const res = await fetch(`/api/batch-calls/${batchId}`);
      const body = await res.json();
      if (res.ok) setTargetsByBatch((prev) => ({ ...prev, [batchId]: body.targets }));
    } finally {
      setLoadingTargets(null);
    }
  }, [expandedId, targetsByBatch]);

  const handleCreate = async () => {
    if (!tenantId || !versionId || preview.count === 0) return;
    if (timing === 'schedule' && !scheduledAt) {
      setError('Pick a date and time to schedule for');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/batch-calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentVersionId: versionId,
          phoneNumbers: numbersText,
          name: name.trim() || undefined,
          scheduledAt: timing === 'schedule' ? new Date(scheduledAt).toISOString() : undefined,
          callTimeWindow: windowEnabled
            ? { timezone: windowTimezone, days: windowDays, start_hour: windowStart, end_hour: windowEnd }
            : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setNumbersText('');
      setVersionId('');
      setName('');
      setTiming('now');
      setScheduledAt('');
      setWindowEnabled(false);
      setShowCreate(false);
      setBatches((prev) => [body.batchCall, ...prev]);
      // A "Send Now" batch is inert until triggered — kick it off right away.
      // A scheduled batch stays pending; the due-batches cron runs it later.
      if (timing === 'now') await runBatch(body.batchCall.id);
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
            <label className="mb-1.5 block text-[13px] font-medium text-[#1a1d29]">Name <span className="text-gray-400">(optional)</span></label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q3 renewal reminders"
              className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] text-[#1a1d29] placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>

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
              placeholder={'+14155551234\n+14155555678\n…one per line, or comma-separated\n\nOr paste a CSV with a header row — a "phone" column is the recipient,\nany other column (e.g. "first_name") personalizes that call as {{first_name}}.'}
              className="w-full resize-y rounded-lg border border-gray-200 px-3.5 py-2.5 font-mono text-[13px] text-[#1a1d29] placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <p className="mt-1 text-[12px] text-gray-400">
              {preview.count} number{preview.count === 1 ? '' : 's'} detected.
              {preview.variableNames.length > 0 && (
                <> Personalizing with: {preview.variableNames.map((v) => `{{${v}}}`).join(', ')}.</>
              )}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[#1a1d29]">When</label>
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5">
              <button
                onClick={() => setTiming('now')}
                className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition ${timing === 'now' ? 'bg-[#1a1d29] text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                Send now
              </button>
              <button
                onClick={() => setTiming('schedule')}
                className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition ${timing === 'schedule' ? 'bg-[#1a1d29] text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                Schedule
              </button>
            </div>
            {timing === 'schedule' && (
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                className="mt-2 block rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] text-[#1a1d29] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            )}
          </div>

          <div>
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1 text-[12.5px] font-medium text-blue-600 hover:text-blue-700"
            >
              <ChevronIcon className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              Advanced: restrict calling hours
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-3 rounded-lg border border-gray-100 bg-gray-50/60 p-4">
                <label className="flex items-center gap-2 text-[13px] text-[#1a1d29]">
                  <input type="checkbox" checked={windowEnabled} onChange={(e) => setWindowEnabled(e.target.checked)} />
                  Only call within a specific window
                </label>
                {windowEnabled && (
                  <div className="space-y-3 pl-6">
                    <div className="flex flex-wrap items-center gap-2">
                      {DAY_LABELS.map((d, i) => (
                        <button
                          key={d}
                          onClick={() => setWindowDays((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))}
                          className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${windowDays.includes(i) ? 'bg-[#1a1d29] text-white' : 'bg-white text-gray-600 ring-1 ring-inset ring-gray-200'}`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[13px] text-[#1a1d29]">
                      <span>Between</span>
                      <select value={windowStart} onChange={(e) => setWindowStart(Number(e.target.value))} className="rounded-md border border-gray-200 px-2 py-1 text-[13px]">
                        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
                      </select>
                      <span>and</span>
                      <select value={windowEnd} onChange={(e) => setWindowEnd(Number(e.target.value))} className="rounded-md border border-gray-200 px-2 py-1 text-[13px]">
                        {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h}>{h}:00</option>)}
                      </select>
                      <input
                        value={windowTimezone}
                        onChange={(e) => setWindowTimezone(e.target.value)}
                        className="w-56 rounded-md border border-gray-200 px-2 py-1 text-[13px] font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              disabled={isSubmitting || !versionId || preview.count === 0}
              className="whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
            >
              {isSubmitting
                ? 'Saving…'
                : timing === 'schedule'
                  ? `Schedule batch call${preview.count ? ` (${preview.count})` : ''}`
                  : `Start batch call${preview.count ? ` (${preview.count})` : ''}`}
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
              <th className="px-5 py-3 font-medium">Batch</th>
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
                const isScheduledFuture = batch.status === 'pending' && batch.scheduled_at && new Date(batch.scheduled_at) > new Date();
                const isExpanded = expandedId === batch.id;
                return (
                  <Fragment key={batch.id}>
                    <tr
                      onClick={() => toggleExpand(batch.id)}
                      className="cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50/70"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5 font-medium text-[#1a1d29]">
                          <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-blue-50 text-blue-500">
                            <BatchIcon />
                          </span>
                          <div>
                            <div>{batch.name || versionLabel(version)}</div>
                            {batch.name && <div className="text-[12px] font-normal text-gray-400">{versionLabel(version)}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-gray-600">
                        {batch.called_count ?? 0}/{batch.target_count ?? 0} placed
                        {batch.failed_count ? <span className="ml-1 text-red-500">· {batch.failed_count} failed</span> : null}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={batch.status} />
                          {isScheduledFuture && (
                            <span className="text-[11.5px] text-gray-400">Scheduled for {new Date(batch.scheduled_at!).toLocaleString()}</span>
                          )}
                          {batch.call_time_window && (
                            <span className="text-[11.5px] text-gray-400">
                              {batch.call_time_window.start_hour}:00-{batch.call_time_window.end_hour}:00 {batch.call_time_window.timezone}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-gray-500">{new Date(batch.created_at).toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-right">
                        {batch.status === 'pending' && !isScheduledFuture && (
                          <button
                            onClick={(e) => { e.stopPropagation(); runBatch(batch.id); }}
                            disabled={runningId === batch.id}
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
                          >
                            {runningId === batch.id ? 'Running…' : 'Run'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${batch.id}-detail`} className="border-b border-gray-50 bg-gray-50/40">
                        <td colSpan={5} className="px-5 py-3.5">
                          {loadingTargets === batch.id ? (
                            <p className="text-[12.5px] text-gray-400">Loading…</p>
                          ) : (
                            <table className="w-full text-[12.5px]">
                              <thead>
                                <tr className="text-left text-gray-400">
                                  <th className="pb-1.5 pr-4 font-medium">Number</th>
                                  <th className="pb-1.5 pr-4 font-medium">Status</th>
                                  <th className="pb-1.5 pr-4 font-medium">Variables</th>
                                  <th className="pb-1.5 font-medium">Call</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(targetsByBatch[batch.id] || []).map((t) => (
                                  <tr key={t.id} className="border-t border-gray-100">
                                    <td className="py-1.5 pr-4 font-mono text-[#1a1d29]">{t.phone_number}</td>
                                    <td className="py-1.5 pr-4">
                                      <span className={
                                        t.status === 'failed' ? 'text-red-500' : t.status === 'calling' ? 'text-blue-600' : 'text-gray-400'
                                      }>
                                        {t.status}
                                      </span>
                                    </td>
                                    <td className="py-1.5 pr-4 text-gray-500">
                                      {t.dynamic_variables ? Object.entries(t.dynamic_variables).map(([k, v]) => `${k}=${v}`).join(', ') : '—'}
                                    </td>
                                    <td className="py-1.5">
                                      {t.call_log_id ? (
                                        <a href={`/dashboard/calls/${t.call_log_id}`} className="text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>
                                          View
                                        </a>
                                      ) : t.status === 'calling' ? (
                                        <span className="text-gray-400">See Call Logs</span>
                                      ) : (
                                        '—'
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
    <span className={`inline-flex w-fit rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${styles[status]}`}>
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
