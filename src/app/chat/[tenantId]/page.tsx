'use client';

import { use } from 'react';
import ChatPanel from '@/components/ChatPanel';

// Public, standalone chat page — a website visitor lands here (e.g. linked from
// a tenant's site) and talks to the tenant's AI over text, driven by the same
// flow engine the voice channel runs. No auth, no dashboard chrome.
export default function ChatPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = use(params);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="h-[85vh] w-full max-w-2xl">
        <ChatPanel tenantId={tenantId} variant="full" />
      </div>
    </div>
  );
}
