// Follows a test call through the flow canvas. The engine (call-loop-poc) lists live calls at
// GET /active-calls with each call's current flow node; this module decides which of those is the
// call we just placed and what the canvas should show. Pure so it can be unit tested without a poll loop.

export interface ActiveCallLite {
  id: string;
  currentNodeId: string | null;
}

export type LiveCallStatus = 'waiting' | 'live' | 'ended' | 'timeout';

export interface LiveCallState {
  status: LiveCallStatus;
  /** Calls that were already live before ours; null until the first successful poll. */
  baseline: string[] | null;
  callId: string | null;
  nodeId: string | null;
}

// A call only registers with the engine once the callee picks up and the media socket connects, so
// "waiting" covers ringing too. Past this we assume the call is not coming (declined, voicemail, or an
// engine that doesn't report live state).
export const LIVE_CALL_WAIT_MS = 90_000;

export function initialLiveCallState(): LiveCallState {
  return { status: 'waiting', baseline: null, callId: null, nodeId: null };
}

// Matching by "wasn't live when we started" instead of by timestamp or number avoids clock skew between
// the browser and the engine, and works whichever number the engine reports for an outbound call.
export function nextLiveCallState(prev: LiveCallState, calls: ActiveCallLite[], elapsedMs: number): LiveCallState {
  if (prev.status === 'ended' || prev.status === 'timeout') return prev;

  if (prev.baseline === null) {
    return { ...prev, baseline: calls.map((c) => c.id) };
  }

  if (prev.callId === null) {
    const known = new Set(prev.baseline);
    const ours = calls.find((c) => !known.has(c.id));
    if (ours) return { ...prev, status: 'live', callId: ours.id, nodeId: ours.currentNodeId };
    return elapsedMs > LIVE_CALL_WAIT_MS ? { ...prev, status: 'timeout' } : prev;
  }

  const ours = calls.find((c) => c.id === prev.callId);
  if (!ours) return { ...prev, status: 'ended', nodeId: null };
  return ours.currentNodeId === prev.nodeId ? prev : { ...prev, nodeId: ours.currentNodeId };
}
