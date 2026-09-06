'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, type ChatSession, type ChatMessage } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';

export default function ChatDetailPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!sessionId) return;
      setIsLoading(true);
      try {
        const data = await api.getChatSession(sessionId);
        setSession(data.session);
        setMessages(data.messages);
      } catch (err) {
        console.error('Failed to load chat session:', err);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [sessionId]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-[13.5px] text-gray-400">Loading chat…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="py-14 text-center">
        <p className="mb-3 text-[13.5px] text-gray-400">Chat not found</p>
        <Link href="/dashboard/chat-history" className="font-medium text-blue-600 hover:text-blue-700">
          Back to Chat History
        </Link>
      </div>
    );
  }

  const ended = Boolean(session.ended_at);
  const collected = ((session.state as { collectedData?: Record<string, string> } | null)?.collectedData) || {};
  const hasCollected = Object.keys(collected).length > 0;

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => router.back()} className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 19 8 12l7-7" />
          </svg>
        </button>
        <div>
          <h1 className="font-mono text-[20px] font-semibold text-[#1a1d29]">#{session.id.slice(0, 8)}</h1>
          <p className="text-[12.5px] text-gray-400">{formatRelativeTime(session.created_at)}</p>
        </div>
        <StatusBadge ended={ended} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Session Info */}
        <div className="col-span-1 space-y-5">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3.5 text-[14px] font-semibold text-[#1a1d29]">Chat Information</h2>
            <div className="space-y-3">
              <InfoRow label="Session" value={`#${session.id.slice(0, 8)}`} />
              <InfoRow label="Messages" value={String(messages.length)} />
              <InfoRow label="Status" value={ended ? 'ended' : 'active'} />
              <InfoRow label="Started" value={new Date(session.created_at).toLocaleString()} />
              {session.ended_at && <InfoRow label="Ended" value={new Date(session.ended_at).toLocaleString()} />}
            </div>
          </div>

          {hasCollected && (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="mb-3.5 text-[14px] font-semibold text-[#1a1d29]">Collected Information</h2>
              <div className="space-y-2.5">
                {Object.entries(collected).map(([key, value]) => (
                  <div key={key}>
                    <p className="text-[12px] capitalize text-gray-400">{key.replace(/_/g, ' ')}</p>
                    <p className="text-[13.5px] font-medium text-[#1a1d29]">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Transcript */}
        <div className="col-span-1 lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3.5 text-[14px] font-semibold text-[#1a1d29]">Transcript</h2>
            {messages.length === 0 ? (
              <p className="py-8 text-center text-[13.5px] text-gray-400">No messages</p>
            ) : (
              <div className="max-h-[600px] space-y-3 overflow-y-auto">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === 'assistant' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[80%] rounded-lg p-3.5 ${m.role === 'assistant' ? 'bg-blue-50 text-blue-900' : 'bg-gray-100 text-[#1a1d29]'}`}>
                      <p className="mb-1 text-[11px] capitalize text-gray-400">{m.role === 'assistant' ? 'AI Assistant' : 'Visitor'}</p>
                      <p className="whitespace-pre-wrap text-[13.5px]">{m.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[13.5px]">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium capitalize text-[#1a1d29]">{value}</span>
    </div>
  );
}

function StatusBadge({ ended }: { ended: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${
        ended ? 'bg-gray-100 text-gray-600' : 'bg-green-50 text-green-700'
      }`}
    >
      {ended ? 'ended' : 'active'}
    </span>
  );
}
