'use client';

import { useEffect, useRef, useState } from 'react';

// The core text-chat UI + session logic, shared by the floating ChatWidget and
// the standalone /chat/[tenantId] page. Talks to the public /api/chat/* routes
// (no auth — a website visitor is anonymous), which drive the same node-based
// flow engine voice calls use. Light theme, bubble style matched to the call
// transcript view (assistant = blue-50 left, visitor = gray-100 right).

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatPanelProps {
  tenantId: string;
  // 'full' = standalone page (fills its container); 'widget' = inside the
  // floating popover (fixed height). Only affects outer sizing classes.
  variant?: 'full' | 'widget';
}

export default function ChatPanel({ tenantId, variant = 'full' }: ChatPanelProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isStarting, setIsStarting] = useState(true);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Open a session once on mount.
  useEffect(() => {
    let cancelled = false;
    async function start() {
      setIsStarting(true);
      setError(null);
      try {
        const res = await fetch('/api/chat/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Failed to start chat');
        if (cancelled) return;
        setSessionId(body.sessionId);
        setBusinessName(body.businessName || '');
        setMessages(body.messages || []);
        setEnded(Boolean(body.ended));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to start chat');
      } finally {
        if (!cancelled) setIsStarting(false);
      }
    }
    start();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  // Autoscroll to newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isSending]);

  async function send() {
    const text = input.trim();
    if (!text || !sessionId || isSending || ended) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setIsSending(true);
    setError(null);
    try {
      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, text }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to send message');
      setMessages((prev) => [...prev, ...(body.messages || [])]);
      setEnded(Boolean(body.ended));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const outer =
    variant === 'widget'
      ? 'flex h-[32rem] w-full flex-col overflow-hidden bg-white'
      : 'flex h-full w-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white';

  return (
    <div className={outer}>
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-gray-100 bg-gray-50/60 px-4 py-3">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#1a1d29] text-white">
          <ChatIcon />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold text-[#1a1d29]">
            {businessName ? `${businessName} Assistant` : 'Chat'}
          </p>
          <p className="text-[11.5px] text-gray-400">{ended ? 'Conversation ended' : 'We typically reply instantly'}</p>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {isStarting ? (
          <p className="py-8 text-center text-[13.5px] text-gray-400">Starting chat…</p>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'assistant' ? 'justify-start' : 'justify-end'}`}>
              <div
                className={`max-w-[80%] rounded-lg p-3 ${
                  m.role === 'assistant' ? 'bg-blue-50 text-blue-900' : 'bg-gray-100 text-[#1a1d29]'
                }`}
              >
                <p className="whitespace-pre-wrap text-[13.5px]">{m.content}</p>
              </div>
            </div>
          ))
        )}
        {isSending && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-blue-50 p-3 text-[13.5px] text-blue-400">…</div>
          </div>
        )}
        {ended && !isStarting && (
          <p className="pt-2 text-center text-[11.5px] text-gray-400">This conversation has ended.</p>
        )}
      </div>

      {error && <p className="border-t border-red-100 bg-red-50 px-4 py-2 text-[12px] text-red-600">{error}</p>}

      {/* Input */}
      <div className="border-t border-gray-100 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            disabled={ended || isStarting || !sessionId}
            placeholder={ended ? 'Chat ended' : 'Type a message…'}
            className="max-h-28 flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-[13.5px] text-[#1a1d29] outline-none placeholder:text-gray-400 focus:border-gray-300 disabled:bg-gray-50"
          />
          <button
            onClick={send}
            disabled={!input.trim() || isSending || ended || isStarting || !sessionId}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-[#1a1d29] text-white transition hover:bg-[#2a2e3d] disabled:opacity-40"
            aria-label="Send message"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7z" />
    </svg>
  );
}
