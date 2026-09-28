'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useOnboarding } from '@/context/OnboardingContext';
import { api, type SmsMessage, type PhoneNumber, ApiError } from '@/lib/api';
import { formatPhoneDisplay, formatRelativeTime } from '@/lib/utils';

export default function SmsThreadPage() {
  const params = useParams();
  const router = useRouter();
  const rawPhoneNumber = decodeURIComponent(params.phoneNumber as string);
  const { tenantId, isHydrated } = useOnboarding();

  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      if (!tenantId || !isHydrated) return;

      setIsLoading(true);
      setError(null);
      try {
        const [thread, numbers] = await Promise.all([
          api.getSmsThread(tenantId, rawPhoneNumber),
          api.getPhoneNumbers(tenantId),
        ]);
        setMessages(thread.messages);
        setPhoneNumbers(numbers);
      } catch (err) {
        console.error('Failed to load SMS thread:', err);
        setError(err instanceof Error ? err.message : 'Failed to load conversation');
      } finally {
        setIsLoading(false);
      }
    }

    load();
  }, [tenantId, isHydrated, rawPhoneNumber]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  // The tenant's own number in this thread — whichever side of the last
  // message isn't the counterpart — so a reply is sent from the same
  // number the conversation has been happening on. Falls back to the
  // tenant's first phone number for a brand-new thread with no history.
  const lastMessage = messages[messages.length - 1];
  const tenantNumber = lastMessage
    ? lastMessage.direction === 'inbound'
      ? lastMessage.to_number
      : lastMessage.from_number
    : phoneNumbers[0]?.number;
  const fromPhoneNumber = phoneNumbers.find((p) => p.number === tenantNumber) || phoneNumbers[0];

  async function handleSend() {
    const body = draft.trim();
    if (!body || !tenantId || !fromPhoneNumber) return;

    setIsSending(true);
    setSendError(null);
    try {
      const sent = await api.sendSms(tenantId, {
        phoneNumberId: fromPhoneNumber.id,
        toNumber: rawPhoneNumber,
        body,
      });
      setMessages((prev) => [...prev, sent]);
      setDraft('');
    } catch (err) {
      console.error('Failed to send SMS:', err);
      setSendError(err instanceof ApiError ? err.message : 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() => router.push('/dashboard/sms')}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Back to messages"
        >
          <BackIcon />
        </button>
        <h1 className="text-[22px] font-semibold text-[#1a1d29]">{formatPhoneDisplay(rawPhoneNumber)}</h1>
      </div>

      <div className="flex h-[65vh] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-[13.5px] text-gray-400">Loading conversation…</div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-[13.5px] text-red-500">{error}</div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[13.5px] text-gray-400">No messages yet. Say hello!</div>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-[13.5px] ${
                      m.direction === 'outbound' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-[#1a1d29]'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p className={`mt-1 text-[10.5px] ${m.direction === 'outbound' ? 'text-blue-100' : 'text-gray-400'}`}>
                      {formatRelativeTime(m.created_at)}
                      {m.direction === 'outbound' && m.status === 'failed' && ' · Failed'}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 p-3">
          {sendError && <p className="mb-2 px-1 text-[12px] text-red-500">{sendError}</p>}
          {!isLoading && !fromPhoneNumber ? (
            <p className="px-1 text-[12.5px] text-gray-400">
              No phone number available to send from. <Link href="/dashboard/numbers" className="text-blue-600 hover:underline">Add one</Link>.
            </p>
          ) : (
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Type a message…"
                rows={1}
                className="max-h-32 flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-[13.5px] outline-none focus:border-blue-400"
              />
              <button
                onClick={handleSend}
                disabled={isSending || !draft.trim()}
                className="rounded-lg bg-[#1a1d29] px-4 py-2 text-[13px] font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSending ? 'Sending…' : 'Send'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 19-7-7 7-7" />
    </svg>
  );
}
