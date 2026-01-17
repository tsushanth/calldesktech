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

  const filteredCalls = filter === 'all'
    ? calls
    : calls.filter(call => call.outcome === filter);

  const outcomes = ['all', 'booked', 'answered', 'transferred', 'voicemail', 'abandoned'];

  return (
    <>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">Call Logs</h1>
        <div className="flex gap-2">
          {outcomes.map((outcome) => (
            <button
              key={outcome}
              onClick={() => setFilter(outcome)}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${
                filter === outcome
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {outcome.charAt(0).toUpperCase() + outcome.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl border border-gray-700">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Loading calls...</div>
        ) : filteredCalls.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            {filter === 'all'
              ? 'No calls yet. Your AI receptionist is ready to answer!'
              : `No ${filter} calls found.`}
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {filteredCalls.map((call) => (
              <Link
                key={call.id}
                href={`/dashboard/calls/${call.id}`}
                className="p-4 flex items-center justify-between hover:bg-gray-700/50 block"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center">
                    <span className="text-lg">📞</span>
                  </div>
                  <div>
                    <p className="font-medium">{formatPhoneDisplay(call.caller_phone)}</p>
                    <p className="text-sm text-gray-400">{formatRelativeTime(call.created_at)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-sm text-gray-400">Duration</p>
                    <p className="font-medium">{formatDuration(call.duration_seconds)}</p>
                  </div>
                  <OutcomeBadge outcome={call.outcome} />
                  <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Summary Stats */}
      {!isLoading && calls.length > 0 && (
        <div className="mt-6 grid grid-cols-5 gap-4">
          {outcomes.filter(o => o !== 'all').map((outcome) => {
            const count = calls.filter(c => c.outcome === outcome).length;
            const percentage = Math.round((count / calls.length) * 100);
            return (
              <div key={outcome} className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                <p className="text-gray-400 text-sm capitalize">{outcome}</p>
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-sm text-gray-500">{percentage}%</p>
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
    booked: 'bg-green-500/20 text-green-400',
    answered: 'bg-blue-500/20 text-blue-400',
    transferred: 'bg-yellow-500/20 text-yellow-400',
    voicemail: 'bg-gray-500/20 text-gray-400',
    abandoned: 'bg-red-500/20 text-red-400',
  };

  return (
    <span className={`px-3 py-1.5 rounded text-sm font-medium ${colors[outcome] || colors.answered}`}>
      {outcome}
    </span>
  );
}
