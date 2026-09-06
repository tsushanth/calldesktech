'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useOnboarding } from '@/context/OnboardingContext';
import { api, type ChatSessionSummary } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';

export default function ChatHistoryPage() {
  const { tenantId, isHydrated } = useOnboarding();
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'ended'>('all');

  useEffect(() => {
    async function loadSessions() {
      if (!tenantId || !isHydrated) return;
      setIsLoading(true);
      try {
        const data = await api.getChatSessions(tenantId, 100);
        setSessions(data);
      } catch (err) {
        console.error('Failed to load chat sessions:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadSessions();
  }, [tenantId, isHydrated]);

  const filtered =
    filter === 'all'
      ? sessions
      : sessions.filter((s) => (filter === 'ended' ? s.ended_at : !s.ended_at));
  const filters: Array<'all' | 'active' | 'ended'> = ['all', 'active', 'ended'];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] font-semibold text-[#1a1d29]">Chat History</h1>
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
                filter === f ? 'bg-[#1a1d29] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
              } border border-gray-200`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {isLoading ? (
          <div className="p-10 text-center text-[13.5px] text-gray-400">Loading chats…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-[13.5px] text-gray-400">
            {filter === 'all' ? 'No chats yet. Your AI is ready to answer text messages!' : `No ${filter} chats found.`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60 text-[11.5px] uppercase tracking-wide text-gray-400">
                  <th className="px-5 py-3 font-medium">Session</th>
                  <th className="px-5 py-3 font-medium">Started</th>
                  <th className="px-5 py-3 font-medium">Messages</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/70">
                    <td className="px-5 py-3.5">
                      <Link href={`/dashboard/chat-history/${s.id}`} className="flex items-center gap-2.5 font-medium text-[#1a1d29] hover:text-blue-600">
                        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-gray-100 text-gray-400">
                          <ChatIcon />
                        </span>
                        <span className="font-mono text-[12.5px]">#{s.id.slice(0, 8)}</span>
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{formatRelativeTime(s.created_at)}</td>
                    <td className="px-5 py-3.5 font-mono text-gray-600">{s.message_count}</td>
                    <td className="px-5 py-3.5">
                      <StatusBadge ended={Boolean(s.ended_at)} />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link href={`/dashboard/chat-history/${s.id}`} className="text-gray-300 hover:text-gray-500">
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

      {!isLoading && sessions.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Total chats" value={sessions.length} />
          <StatCard label="Active" value={sessions.filter((s) => !s.ended_at).length} />
          <StatCard label="Messages" value={sessions.reduce((sum, s) => sum + s.message_count, 0)} />
        </div>
      )}
    </>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className="text-[20px] font-semibold text-[#1a1d29]">{value}</p>
    </div>
  );
}

function StatusBadge({ ended }: { ended: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${
        ended ? 'bg-gray-100 text-gray-600' : 'bg-green-50 text-green-700'
      }`}
    >
      {ended ? 'ended' : 'active'}
    </span>
  );
}

function ChatIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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
