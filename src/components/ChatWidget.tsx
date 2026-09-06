'use client';

import { useState } from 'react';
import ChatPanel from './ChatPanel';

// Floating chat launcher for embedding on a tenant's site (or previewing in
// the dashboard). A bottom-right bubble that toggles the ChatPanel popover.
// Mount it once with the tenant id: <ChatWidget tenantId={...} />.
export default function ChatWidget({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-[22rem] max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
          <ChatPanel tenantId={tenantId} variant="widget" />
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[#1a1d29] text-white shadow-lg transition hover:bg-[#2a2e3d]"
        aria-label={open ? 'Close chat' : 'Open chat'}
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>
    </div>
  );
}
