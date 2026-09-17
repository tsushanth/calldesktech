'use client';

import { useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

// This page's builder moved to the agent detail page itself
// (/dashboard/agents/[id]) — a single persistent builder shell (node
// palette, canvas, Global/Node Settings panel, Simulation/Workflow tabs)
// replacing this separate wizard route and the old empty "create first
// version" landing page. Kept as a redirect, not deleted, so any existing
// bookmark or link still lands somewhere real instead of 404ing.
export default function LegacyNewVersionRedirect() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const agentId = params.id as string;

  useEffect(() => {
    const channel = searchParams.get('channel');
    router.replace(`/dashboard/agents/${agentId}${channel ? `?channel=${channel}` : ''}`);
  }, [agentId, router, searchParams]);

  return null;
}
