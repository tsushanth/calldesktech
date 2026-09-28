'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useOnboarding } from '@/context/OnboardingContext';
import { api, type SmsConversation } from '@/lib/api';
import { formatPhoneDisplay, formatRelativeTime } from '@/lib/utils';

export default function SmsPage() {
  const { tenantId, isHydrated } = useOnboarding();
  const [conversations, setConversations] = useState<SmsConversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadConversations() {
      if (!tenantId || !isHydrated) return;

      setIsLoading(true);
      setError(null);
      try {
        const data = await api.getSmsConversations(tenantId, 100);
        setConversations(data);
      } catch (err) {
        console.error('Failed to load SMS conversations:', err);
        setError(err instanceof Error ? err.message : 'Failed to load conversations');
      } finally {
        setIsLoading(false);
      }
    }

    loadConversations();
  }, [tenantId, isHydrated]);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] font-semibold text-[#1a1d29]">Messages</h1>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {isLoading ? (
          <div className="p-10 text-center text-[13.5px] text-gray-400">Loading conversations…</div>
        ) : error ? (
          <div className="p-10 text-center text-[13.5px] text-red-500">{error}</div>
        ) : conversations.length === 0 ? (
          <div className="p-10 text-center text-[13.5px] text-gray-400">
            No SMS conversations yet. Messages your numbers send or receive will show up here.
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {conversations.map((conv) => (
              <Link
                key={conv.phoneNumber}
                href={`/dashboard/sms/${encodeURIComponent(conv.phoneNumber)}`}
                className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50/70"
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gray-100 text-gray-400">
                  <MessageIcon />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-[#1a1d29]">{formatPhoneDisplay(conv.phoneNumber)}</span>
                    {conv.unreadCount > 0 && (
                      <span className="flex h-5 min-w-5 flex-none items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10.5px] font-semibold text-white">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[12.5px] text-gray-500">
                    {conv.direction === 'outbound' ? 'You: ' : ''}
                    {conv.preview}
                  </p>
                </div>
                <span className="flex-none text-[12px] text-gray-400">{formatRelativeTime(conv.lastMessageAt)}</span>
                <ChevronIcon />
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function MessageIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-gray-300">
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}
