'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useOnboarding } from '@/context/OnboardingContext';
import { api, type CallQa } from '@/lib/api';
import { formatPhoneDisplay, formatRelativeTime } from '@/lib/utils';

const sentiments = ['all', 'positive', 'neutral', 'negative'] as const;

export default function QualityAssurancePage() {
  const { tenantId, isHydrated } = useOnboarding();
  const [calls, setCalls] = useState<CallQa[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [isRunning, setIsRunning] = useState(false);
  const [runNote, setRunNote] = useState<string | null>(null);

  const loadCalls = useCallback(async () => {
    if (!tenantId || !isHydrated) return;
    setIsLoading(true);
    try {
      const data = await api.getCallQa(tenantId, 100);
      setCalls(data);
    } catch (err) {
      console.error('Failed to load QA results:', err);
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, isHydrated]);

  useEffect(() => {
    loadCalls();
  }, [loadCalls]);

  async function handleRunQa() {
    if (!tenantId || isRunning) return;
    setIsRunning(true);
    setRunNote(null);
    try {
      const res = await api.runCallQa(tenantId);
      setRunNote(
        res.processed === 0
          ? 'All calls with a transcript are already scored.'
          : `Scored ${res.completed} call${res.completed === 1 ? '' : 's'}` +
              (res.failed ? `, ${res.failed} failed` : '') +
              (res.skipped ? `, ${res.skipped} skipped` : '') +
              '.'
      );
      await loadCalls();
    } catch (err) {
      setRunNote(err instanceof Error ? err.message : 'Failed to run QA.');
    } finally {
      setIsRunning(false);
    }
  }

  const filteredCalls =
    filter === 'all' ? calls : calls.filter((call) => call.qa_sentiment === filter);

  const scored = calls.filter((c) => c.qa_status === 'completed' && c.qa_score != null);
  const avgScore =
    scored.length > 0
      ? scored.reduce((sum, c) => sum + (c.qa_score || 0), 0) / scored.length
      : 0;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-[#1a1d29]">AI Quality Assurance</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Automated post-call review — sentiment, a 1–5 quality score, and a critique for every call.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {sentiments.map((sentiment) => (
            <button
              key={sentiment}
              onClick={() => setFilter(sentiment)}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
                filter === sentiment ? 'bg-[#1a1d29] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
              } border border-gray-200`}
            >
              {sentiment.charAt(0).toUpperCase() + sentiment.slice(1)}
            </button>
          ))}
          <button
            onClick={handleRunQa}
            disabled={isRunning}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRunning ? 'Scoring…' : 'Run QA on pending calls'}
          </button>
        </div>
      </div>

      {runNote && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-[12.5px] text-gray-600">
          {runNote}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {isLoading ? (
          <div className="p-10 text-center text-[13.5px] text-gray-400">Loading QA results…</div>
        ) : filteredCalls.length === 0 ? (
          <div className="p-10 text-center text-[13.5px] text-gray-400">
            {filter === 'all'
              ? 'No calls yet. QA scores appear automatically after each call ends.'
              : `No ${filter} calls found.`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60 text-[11.5px] uppercase tracking-wide text-gray-400">
                  <th className="px-5 py-3 font-medium">Caller</th>
                  <th className="px-5 py-3 font-medium">Time</th>
                  <th className="px-5 py-3 font-medium">Sentiment</th>
                  <th className="px-5 py-3 font-medium">Score</th>
                  <th className="px-5 py-3 font-medium">Critique</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {filteredCalls.map((call) => (
                  <tr key={call.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/70">
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/dashboard/calls/${call.id}`}
                        className="flex items-center gap-2.5 font-medium text-[#1a1d29] hover:text-blue-600"
                      >
                        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-gray-100 text-gray-400">
                          <PhoneIcon />
                        </span>
                        {formatPhoneDisplay(call.caller_phone)}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{formatRelativeTime(call.created_at)}</td>
                    <td className="px-5 py-3.5">
                      {call.qa_status === 'completed' && call.qa_sentiment ? (
                        <SentimentBadge sentiment={call.qa_sentiment} />
                      ) : (
                        <StatusBadge status={call.qa_status} />
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {call.qa_status === 'completed' && call.qa_score != null ? (
                        <ScoreBadge score={call.qa_score} />
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 max-w-md text-gray-600">
                      <span className="line-clamp-2" title={call.qa_critique || undefined}>
                        {call.qa_critique || <span className="text-gray-300">—</span>}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link href={`/dashboard/calls/${call.id}`} className="text-gray-300 hover:text-gray-500">
                        <ChevronIcon />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Summary */}
      {!isLoading && scored.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-[12px] text-gray-500">Calls scored</p>
            <p className="text-[20px] font-semibold text-[#1a1d29]">{scored.length}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-[12px] text-gray-500">Avg score</p>
            <p className="text-[20px] font-semibold text-[#1a1d29]">{avgScore.toFixed(1)}/5</p>
          </div>
          {(['positive', 'neutral', 'negative'] as const).map((sentiment) => {
            const count = scored.filter((c) => c.qa_sentiment === sentiment).length;
            const percentage = Math.round((count / scored.length) * 100);
            return (
              <div key={sentiment} className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-[12px] capitalize text-gray-500">{sentiment}</p>
                <p className="text-[20px] font-semibold text-[#1a1d29]">{count}</p>
                <p className="text-[12px] text-gray-400">{percentage}%</p>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function SentimentBadge({ sentiment }: { sentiment: 'positive' | 'neutral' | 'negative' }) {
  const colors: Record<string, string> = {
    positive: 'bg-green-50 text-green-700',
    neutral: 'bg-gray-100 text-gray-600',
    negative: 'bg-red-50 text-red-700',
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${colors[sentiment]}`}>
      {sentiment}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700',
    failed: 'bg-red-50 text-red-700',
    skipped: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${colors[status] || colors.pending}`}>
      {status}
    </span>
  );
}

function ScoreBadge({ score }: { score: number }) {
  // Green for strong calls, amber for middling, red for poor.
  const tone =
    score >= 4 ? 'bg-green-50 text-green-700' : score === 3 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700';
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${tone}`}>{score}/5</span>
  );
}

function PhoneIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 4h3l1.5 4-2 1.3a11 11 0 0 0 5.7 5.7l1.3-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 5 5.6 1.5 1.5 0 0 1 6.5 4Z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}
