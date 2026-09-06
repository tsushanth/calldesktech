'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useOnboarding } from '@/context/OnboardingContext';
import { api, type CallLog } from '@/lib/api';
import { formatPhoneDisplay, formatDuration, formatRelativeTime } from '@/lib/utils';

export default function CallsPage() {
  const { tenantId, isHydrated } = useOnboarding();
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    async function loadCalls() {
      if (!tenantId || !isHydrated) return;

      setIsLoading(true);
      try {
        const data = await api.getCallLogs(tenantId, 100);
        setCalls(data);
      } catch (err) {
        console.error('Failed to load calls:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadCalls();
  }, [tenantId, isHydrated]);

  const filteredCalls = filter === 'all' ? calls : calls.filter((call) => call.outcome === filter);
  const outcomes = ['all', 'booked', 'answered', 'transferred', 'voicemail', 'abandoned'];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] font-semibold text-[#1a1d29]">Call Logs</h1>
        <div className="flex flex-wrap gap-1.5">
          {outcomes.map((outcome) => (
            <button
              key={outcome}
              onClick={() => setFilter(outcome)}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
                filter === outcome ? 'bg-[#1a1d29] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
              } border border-gray-200`}
            >
              {outcome.charAt(0).toUpperCase() + outcome.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {isLoading ? (
          <div className="p-10 text-center text-[13.5px] text-gray-400">Loading calls…</div>
        ) : filteredCalls.length === 0 ? (
          <div className="p-10 text-center text-[13.5px] text-gray-400">
            {filter === 'all' ? 'No calls yet. Your AI receptionist is ready to answer!' : `No ${filter} calls found.`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60 text-[11.5px] uppercase tracking-wide text-gray-400">
                  <th className="px-5 py-3 font-medium">Caller</th>
                  <th className="px-5 py-3 font-medium">Time</th>
                  <th className="px-5 py-3 font-medium">Duration</th>
                  <th className="px-5 py-3 font-medium">Outcome</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {filteredCalls.map((call) => (
                  <tr key={call.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/70">
                    <td className="px-5 py-3.5">
                      <Link href={`/dashboard/calls/${call.id}`} className="flex items-center gap-2.5 font-medium text-[#1a1d29] hover:text-blue-600">
                        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-gray-100 text-gray-400">
                          <PhoneIcon />
                        </span>
                        {formatPhoneDisplay(call.caller_phone)}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{formatRelativeTime(call.created_at)}</td>
                    <td className="px-5 py-3.5 font-mono text-gray-600">{formatDuration(call.duration_seconds)}</td>
                    <td className="px-5 py-3.5">
                      <OutcomeBadge outcome={call.outcome} />
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

      {/* Summary Stats */}
      {!isLoading && calls.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {outcomes
            .filter((o) => o !== 'all')
            .map((outcome) => {
              const count = calls.filter((c) => c.outcome === outcome).length;
              const percentage = Math.round((count / calls.length) * 100);
              return (
                <div key={outcome} className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-[12px] capitalize text-gray-500">{outcome}</p>
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

function OutcomeBadge({ outcome }: { outcome: string }) {
  const colors: Record<string, string> = {
    booked: 'bg-green-50 text-green-700',
    answered: 'bg-blue-50 text-blue-700',
    transferred: 'bg-amber-50 text-amber-700',
    voicemail: 'bg-gray-100 text-gray-600',
    abandoned: 'bg-red-50 text-red-700',
  };

  return <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${colors[outcome] || colors.answered}`}>{outcome}</span>;
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
