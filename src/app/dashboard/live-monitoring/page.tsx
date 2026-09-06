'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useOnboarding } from '@/context/OnboardingContext';
import { formatPhoneDisplay, formatDuration } from '@/lib/utils';

// Live call state — which of this tenant's calls are in progress *right now*
// and what flow node each is on. This is NOT audio monitoring: it polls
// call-loop-poc's /active-calls registry (presence + current flow position),
// it does not stream or let you listen to a call. See the API route.
const POLL_INTERVAL_MS = 4000;

type ActiveCall = {
  id: string;
  tenantId: string | null;
  phoneNumber: string | null;
  startedAt: number;
  currentNodeId: string | null;
  nodeType: string | null;
};

export default function LiveMonitoringPage() {
  const { tenantId, isHydrated } = useOnboarding();
  const [calls, setCalls] = useState<ActiveCall[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Estimated offset between this browser's clock and the engine's, so
  // duration-so-far stays accurate even when the two clocks disagree.
  const clockOffsetRef = useRef(0);
  // A ticking "now" (engine time) so each row's duration counts up every
  // second, independent of the slower poll.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/tenants/${tenantId}/active-calls`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Could not load active calls');
        setCalls([]);
      } else {
        if (typeof data.serverTime === 'number') {
          clockOffsetRef.current = Date.now() - data.serverTime;
        }
        setCalls(Array.isArray(data.calls) ? data.calls : []);
        setError(null);
      }
    } catch {
      setError('Could not reach the server');
      setCalls([]);
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  // Poll the registry.
  useEffect(() => {
    if (!tenantId || !isHydrated) return;
    setIsLoading(true);
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [tenantId, isHydrated, load]);

  // Tick the duration clock once a second (engine-time estimate).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() - clockOffsetRef.current), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[22px] font-semibold text-[#1a1d29]">Live Calls</h1>
          <LiveDot active={calls.length > 0} />
        </div>
        <span className="text-[12.5px] text-gray-400">
          {calls.length} active {calls.length === 1 ? 'call' : 'calls'} · refreshes every {POLL_INTERVAL_MS / 1000}s
        </span>
      </div>

      {/* Honest scope: this is call state, not audio. */}
      <p className="mb-6 text-[12.5px] leading-relaxed text-gray-400">
        Calls in progress right now, with how long each has been running and where it is in the
        conversation flow. This shows active call state — it is not live audio and cannot listen
        in on a call.
      </p>

      {error && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {isLoading ? (
          <div className="p-10 text-center text-[13.5px] text-gray-400">Loading…</div>
        ) : calls.length === 0 ? (
          <div className="p-10 text-center text-[13.5px] text-gray-400">
            No calls in progress right now. Active calls will appear here as they come in.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60 text-[11.5px] uppercase tracking-wide text-gray-400">
                  <th className="px-5 py-3 font-medium">Caller</th>
                  <th className="px-5 py-3 font-medium">Duration</th>
                  <th className="px-5 py-3 font-medium">Current step</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => {
                  const seconds = Math.max(0, Math.floor((now - call.startedAt) / 1000));
                  return (
                    <tr key={call.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/70">
                      <td className="px-5 py-3.5">
                        <span className="flex items-center gap-2.5 font-medium text-[#1a1d29]">
                          <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-green-50 text-green-600">
                            <PhoneIcon />
                          </span>
                          {call.phoneNumber ? formatPhoneDisplay(call.phoneNumber) : 'Unknown caller'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-gray-600">{formatDuration(seconds)}</td>
                      <td className="px-5 py-3.5">
                        <FlowStep nodeType={call.nodeType} nodeId={call.currentNodeId} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function FlowStep({ nodeType, nodeId }: { nodeType: string | null; nodeId: string | null }) {
  if (!nodeType && !nodeId) {
    return <span className="text-[12.5px] text-gray-400">Connecting…</span>;
  }
  const label = (nodeType || 'step').replace(/_/g, ' ');
  return (
    <span className="inline-flex items-center gap-2">
      <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11.5px] font-medium capitalize text-blue-700">
        {label}
      </span>
      {nodeId && <span className="font-mono text-[11.5px] text-gray-400">{nodeId}</span>}
    </span>
  );
}

function LiveDot({ active }: { active: boolean }) {
  if (!active) {
    return <span className="h-2 w-2 rounded-full bg-gray-300" aria-label="No active calls" />;
  }
  return (
    <span className="relative flex h-2 w-2" aria-label="Live">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
    </span>
  );
}

function PhoneIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 4h3l1.5 4-2 1.3a11 11 0 0 0 5.7 5.7l1.3-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 5 5.6 1.5 1.5 0 0 1 6.5 4Z" />
    </svg>
  );
}
