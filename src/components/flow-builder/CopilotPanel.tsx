'use client';

import { useCallback, useEffect, useState } from 'react';

// "Copilot" tab on the agent page: analyzes this agent's real recent call
// history (transcripts + QA critiques) and proposes concrete node-level
// prompt edits, each grounded in specific call transcripts. Never writes to
// the flow itself — Accept creates a new draft version (via
// PATCH .../suggestions/[id] { action: 'accept' }, which itself calls the
// normal POST /api/agents/[id]/versions path); Dismiss just marks the
// suggestion resolved. Mirrors the self-contained tab-component pattern
// used by SimulationTab in the agent page rather than being inlined there.

interface CopilotSuggestion {
  id: string;
  node_id: string;
  current_text: string | null;
  suggested_text: string;
  rationale: string;
  supporting_call_ids: string[];
  status: 'pending' | 'accepted' | 'dismissed';
  created_at: string;
}

export default function CopilotPanel({ agentId }: { agentId: string }) {
  const [suggestions, setSuggestions] = useState<CopilotSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/copilot/analyze`);
      const body = await res.json();
      if (res.ok) setSuggestions(body.suggestions || []);
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/copilot/analyze`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Analysis failed');
      if (body.status === 'not_enough_history') {
        setNotice(body.message);
        return;
      }
      setNotice(body.summary || null);
      setSuggestions((prev) => [...(body.suggestions || []), ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze recent calls');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const resolve = async (id: string, action: 'accept' | 'dismiss') => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/copilot/suggestions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Failed to ${action}`);
      setSuggestions((prev) => prev.map((s) => (s.id === id ? body.suggestion : s)));
      if (action === 'accept') {
        setNotice(`Applied — saved as draft version${body.newVersion?.version_number ? ` v${body.newVersion.version_number}` : ''}. Not yet routed to any phone number.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} suggestion`);
    } finally {
      setBusyId(null);
    }
  };

  const pending = suggestions.filter((s) => s.status === 'pending');
  const resolved = suggestions.filter((s) => s.status !== 'pending');

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-[#1a1d29]">Copilot</h2>
          <p className="text-[13px] text-gray-500">
            Analyzes this agent&apos;s recent real calls (transcripts + QA reviews) for recurring problems and proposes
            specific node edits. Nothing is applied automatically — review each suggestion below.
          </p>
        </div>
        <button
          onClick={handleAnalyze}
          disabled={isAnalyzing}
          className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {isAnalyzing ? 'Analyzing…' : 'Analyze recent calls'}
        </button>
      </div>

      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>}
      {notice && <div className="rounded-md bg-blue-50 px-3 py-2 text-[13px] text-blue-800">{notice}</div>}

      {isLoading ? (
        <div className="text-[13px] text-gray-400">Loading…</div>
      ) : pending.length === 0 && resolved.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-200 px-4 py-8 text-center text-[13px] text-gray-400">
          No suggestions yet. Click &quot;Analyze recent calls&quot; to look for recurring problems in this agent&apos;s call history.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {pending.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} busy={busyId === s.id} onAccept={() => resolve(s.id, 'accept')} onDismiss={() => resolve(s.id, 'dismiss')} />
          ))}
          {resolved.length > 0 && (
            <>
              <div className="mt-2 text-[12px] font-medium uppercase tracking-wide text-gray-400">Resolved</div>
              {resolved.map((s) => (
                <SuggestionCard key={s.id} suggestion={s} busy={false} onAccept={() => {}} onDismiss={() => {}} readOnly />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  busy,
  onAccept,
  onDismiss,
  readOnly,
}: {
  suggestion: CopilotSuggestion;
  busy: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  readOnly?: boolean;
}) {
  return (
    <div className={`rounded-lg border border-gray-200 p-4 ${readOnly ? 'opacity-60' : ''}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-[12px] text-gray-600">{suggestion.node_id}</span>
        {suggestion.status !== 'pending' && (
          <span className={`text-[11px] font-medium uppercase ${suggestion.status === 'accepted' ? 'text-green-600' : 'text-gray-400'}`}>
            {suggestion.status}
          </span>
        )}
      </div>

      <p className="mb-3 text-[13px] text-gray-700">{suggestion.rationale}</p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-md bg-red-50 p-2">
          <div className="mb-1 text-[11px] font-medium uppercase text-red-500">Current</div>
          <div className="whitespace-pre-wrap text-[12px] text-red-900">{suggestion.current_text || '(empty)'}</div>
        </div>
        <div className="rounded-md bg-green-50 p-2">
          <div className="mb-1 text-[11px] font-medium uppercase text-green-600">Suggested</div>
          <div className="whitespace-pre-wrap text-[12px] text-green-900">{suggestion.suggested_text}</div>
        </div>
      </div>

      {suggestion.supporting_call_ids.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          <span className="text-gray-400">Supporting calls:</span>
          {suggestion.supporting_call_ids.map((callId) => (
            <a key={callId} href={`/dashboard/calls/${callId}`} target="_blank" rel="noreferrer" className="font-mono text-blue-600 hover:underline">
              {callId.slice(0, 8)}
            </a>
          ))}
        </div>
      )}

      {!readOnly && (
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onDismiss}
            disabled={busy}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-[12px] font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
          >
            Dismiss
          </button>
          <button
            onClick={onAccept}
            disabled={busy}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Applying…' : 'Accept → new draft version'}
          </button>
        </div>
      )}
    </div>
  );
}
